// useObjectUrl 用例(阶段 7:本地预览的 Blob URL 生命周期)。
// 六类边界覆盖:
//   空值 —— source 为 null/undefined 时既不 create 也不 revoke;
//   零值 —— createObjectURL 返回空串(等价于失败)时不产出可用 URL、不注册 revoke;
//   越界 —— 同一引用反复重渲染不得累积新 URL(几十张预览 × 每次渲染 = 内存泄漏);
//   权限缺失 —— 本站无鉴权,此一类不适用(hook 只做本地对象 URL,不涉及 token);
//   网络失败 —— 无网络;对应的失败路径是 createObjectURL 抛错(隐私模式/配额),必须降级为 null 不外抛;
//   非法状态迁移 —— 换引用与卸载这两条释放路径各只走一次(双 revoke / 漏 revoke 都是 bug)。
// 断言计数必须自己接管 URL.createObjectURL/revokeObjectURL:tests/setup.ts 的 shim 恒返回
// "blob:mock" 且无计数能力,只补环境不承担可观测性。
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useObjectUrl } from "../../src/hooks/use-object-url";

type CreateSpy = ReturnType<typeof vi.fn>;

/** renderHook 的 props 形状:`null` 分支要能传进来,故显式命名而不是靠推断。 */
type SourceProps = { source: Blob | null };

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

let createSpy: CreateSpy;
let revokeSpy: ReturnType<typeof vi.fn>;

// setup.ts 用 defineProperty 装的 shim 不一定可配置,故用普通赋值覆盖(属性本身是 writable),
// 并在 afterEach 还原,避免污染同文件后续用例与其他测试文件。
const stubObjectUrlApi = (create: (...args: unknown[]) => string) => {
  createSpy = vi.fn(create);
  revokeSpy = vi.fn();
  URL.createObjectURL = createSpy as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeSpy as typeof URL.revokeObjectURL;
};

// 每次调用都产出新 Blob:用例必须在 renderHook 外先建好再传进去,
// 在回调里现造会让 hook 每渲染换一次引用,于是「一次卸载释放一次」的断言必然失真。
const makeBlob = (label: string): Blob => new Blob([label], { type: "image/jpeg" });

beforeEach(() => {
  stubObjectUrlApi(() => `blob:first`);
});

afterEach(() => {
  cleanup();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe("空值与零值", () => {
  test("source 为 null:返回 null,不 create 也不 revoke", () => {
    const { result } = renderHook(() => useObjectUrl(null));

    expect(result.current).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  test("source 为 undefined(可选取值传下来的):同样返回 null 且不触碰 API", () => {
    const { result } = renderHook(() => useObjectUrl(undefined));

    expect(result.current).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("卸载空 source 的 hook 不 revoke(从未创建过 URL)", () => {
    const { unmount } = renderHook(() => useObjectUrl(null));

    unmount();

    expect(revokeSpy).not.toHaveBeenCalled();
  });

  test("createObjectURL 返回空串(零值)时按失败处理:url 为 null 且不注册释放", () => {
    stubObjectUrlApi(() => "");
    const blob = makeBlob("a");
    const { result, unmount } = renderHook(() => useObjectUrl(blob));

    expect(result.current).toBeNull();

    unmount();

    expect(revokeSpy).not.toHaveBeenCalled();
  });
});

describe("生成与释放", () => {
  test("有 source 时生成一次并返回该 URL", () => {
    const blob = makeBlob("a");

    const { result } = renderHook(() => useObjectUrl(blob));

    expect(result.current).toBe("blob:first");
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(blob);
  });

  test("同一引用重渲染不重新生成(引用相等即视为同一张图)", () => {
    const blob = makeBlob("a");
    const { result, rerender } = renderHook(() => useObjectUrl(blob));

    rerender();
    rerender();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(result.current).toBe("blob:first");
  });

  test("换引用:旧 URL 释放一次、新 URL 生成一次", () => {
    stubObjectUrlApi((source) => `blob:${(source as Blob).size}`);
    const first = makeBlob("aaa");
    const second = makeBlob("bb");
    const { result, rerender } = renderHook<string | null, SourceProps>(
      ({ source }) => useObjectUrl(source),
      { initialProps: { source: first } }
    );
    expect(result.current).toBe(`blob:${first.size}`);

    rerender({ source: second });

    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(`blob:${first.size}`);
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(`blob:${second.size}`);
  });

  test("卸载时释放当前 URL 一次", () => {
    const blob = makeBlob("a");
    const { unmount } = renderHook(() => useObjectUrl(blob));

    unmount();

    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith("blob:first");
  });

  test("从有图切到 null:释放旧 URL 并把状态归零", () => {
    // props 泛型显式写死:renderHook 默认按 initialProps 收窄,不标注就换不到 null。
    const blob = makeBlob("a");
    const { result, rerender } = renderHook<string | null, SourceProps>(
      ({ source }) => useObjectUrl(source),
      { initialProps: { source: blob } }
    );

    rerender({ source: null });

    expect(result.current).toBeNull();
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith("blob:first");
  });

  test("内容相同但引用不同的两张图各得一个 URL,切走时只释放上一个", () => {
    stubObjectUrlApi(() => `blob:${Math.random()}`);
    const first = makeBlob("same");
    const second = makeBlob("same");
    const { result, rerender } = renderHook<string | null, SourceProps>(
      ({ source }) => useObjectUrl(source),
      { initialProps: { source: first } }
    );
    const firstUrl = result.current;

    rerender({ source: second });

    expect(result.current).not.toBe(firstUrl);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(firstUrl);
  });
});

describe("失败降级", () => {
  test("createObjectURL 抛错(隐私模式/配额耗尽)时返回 null 且不向外抛", () => {
    createSpy = vi.fn(() => {
      throw new Error("blob url quota exceeded");
    });
    URL.createObjectURL = createSpy as typeof URL.createObjectURL;
    revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy as typeof URL.revokeObjectURL;

    const blob = makeBlob("a");
    const { result, unmount } = renderHook(() => useObjectUrl(blob));

    expect(result.current).toBeNull();
    expect(() => unmount()).not.toThrow();
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  test("revokeObjectURL 抛错不影响卸载", () => {
    revokeSpy = vi.fn(() => {
      throw new Error("already revoked");
    });
    URL.revokeObjectURL = revokeSpy as typeof URL.revokeObjectURL;
    const blob = makeBlob("a");
    const { unmount } = renderHook(() => useObjectUrl(blob));

    expect(() => unmount()).not.toThrow();
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });
});
