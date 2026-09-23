// logo 三态映射用例(阶段 13,`src/routes/frames/[styleId]/export/logo-settings.ts`)。
// 六类边界落点:空值(NO_LOGO、选自定义但无文件)、零值(0 字节的图必须挡掉)、
// 越界(清单里没有的 logoId)、权限缺失不适用(本站无鉴权,apps/admin/AGENTS.md 第 3 节)、
// 上游失败(fetch reject / 非 2xx 都要降级成「不画 logo 图」而不是整页失败)、
// 非法状态迁移(快速来回切 logo 时,旧响应不得覆盖新选择)。
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// 预设 logo 的 source 各不相同:模块级缓存在整轮测试里共享,共用 id 会把用例串味。
const assetUrlMock = vi.hoisted(() => vi.fn((path: string) => `/${path}`));

vi.mock("../../../../src/utils/asset-url", () => ({ assetUrl: assetUrlMock }));

import {
  CUSTOM_LOGO_ID,
  NO_LOGO_ID,
  makeDeferred,
  makeImageFile,
  makeLogoEntry
} from "./export-test-harness";
import {
  resolveLogoSettings,
  useLogoSettings
} from "../../../../src/routes/frames/[styleId]/export/logo-settings";

const JUZI = makeLogoEntry("logo-juzi", "JUZI");
const STUDIO = makeLogoEntry("logo-studio", "STUDIO");
const LOGOS = [JUZI, STUDIO];

const fetchMock = vi.fn();

const respondWith = (blob: Blob, ok = true): Response =>
  ({ ok, blob: async () => blob }) as unknown as Response;

beforeEach(() => {
  fetchMock.mockReset();
  assetUrlMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("三态映射", () => {
  test("NO_LOGO:mark 空串、blob null,且一个请求都不发", async () => {
    await expect(resolveLogoSettings(LOGOS, NO_LOGO_ID, null)).resolves.toEqual({
      logoMark: "",
      logoBlob: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("自定义:blob 就是用户那张文件,mark 取文件名主名兜底", async () => {
    const file = makeImageFile("我的水印.png");
    const settings = await resolveLogoSettings(LOGOS, CUSTOM_LOGO_ID, file);
    expect(settings).toEqual({ logoMark: "我的水印", logoBlob: file });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("空值:选了自定义却没传文件 → 等价于不加 logo", async () => {
    await expect(resolveLogoSettings(LOGOS, CUSTOM_LOGO_ID, null)).resolves.toEqual({
      logoMark: "",
      logoBlob: null
    });
  });

  test("零值:0 字节的自定义图不进 blob —— 它会让每一张都解码失败,连累整批", async () => {
    const empty = new File([], "empty.png", { type: "image/png" });
    const settings = await resolveLogoSettings(LOGOS, CUSTOM_LOGO_ID, empty);
    expect(settings.logoBlob).toBeNull();
    expect(settings.logoMark).toBe("empty");
  });

  test("预设:mark 用清单文案,blob 走 assetUrl 拼出的同源地址", async () => {
    const bytes = new Blob(["<svg/>"], { type: "image/svg+xml" });
    fetchMock.mockResolvedValue(respondWith(bytes));

    const settings = await resolveLogoSettings(LOGOS, JUZI.id, null);
    expect(settings.logoMark).toBe("JUZI");
    expect(settings.logoBlob).toBe(bytes);
    // 硬约束:public 资源必须经 assetUrl(子路径部署下裸路径必 404)。
    expect(assetUrlMock).toHaveBeenCalledWith(JUZI.source);
    expect(fetchMock).toHaveBeenCalledWith(`/${JUZI.source}`);
  });

  test("上游失败:fetch reject 只降级不抛错,mark 仍在(绘制端退回文字块)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(resolveLogoSettings(LOGOS, STUDIO.id, null)).resolves.toEqual({
      logoMark: "STUDIO",
      logoBlob: null
    });
  });

  test("上游失败:非 2xx 也降级为 null", async () => {
    const broken = makeLogoEntry("logo-broken", "BROKEN");
    fetchMock.mockResolvedValue(respondWith(new Blob(["x"]), false));
    await expect(resolveLogoSettings([broken], broken.id, null)).resolves.toEqual({
      logoMark: "BROKEN",
      logoBlob: null
    });
  });

  test("零值:0 字节的预设响应不进缓存(否则用户补好文件后刷新仍拿不到图)", async () => {
    const entry = makeLogoEntry("logo-empty", "EMPTY");
    fetchMock.mockResolvedValueOnce(respondWith(new Blob([])));
    expect(await resolveLogoSettings([entry], entry.id, null)).toEqual({
      logoMark: "EMPTY",
      logoBlob: null
    });

    const bytes = new Blob(["<svg/>"]);
    fetchMock.mockResolvedValueOnce(respondWith(bytes));
    expect((await resolveLogoSettings([entry], entry.id, null)).logoBlob).toBe(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("越界:清单里没有的 logoId 不发请求也不报错", async () => {
    await expect(resolveLogoSettings(LOGOS, "ghost-logo", null)).resolves.toEqual({
      logoMark: "",
      logoBlob: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("一次性缓存:来回切同一预设只取一次", async () => {
    const bytes = new Blob(["<svg/>"]);
    fetchMock.mockResolvedValue(respondWith(bytes));
    const cached = makeLogoEntry("logo-cached", "CACHED");

    await resolveLogoSettings([cached], cached.id, null);
    await resolveLogoSettings([cached], cached.id, null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useLogoSettings", () => {
  // 每个用例都造新 logo 条目:预设图缓存在模块级、按 source 记账,
  // 复用 JUZI/STUDIO 会让后面的用例直接命中缓存,fetch 替身根本没机会被用到。
  test("首帧先给空态,解析完成后落到真值", async () => {
    const entry = makeLogoEntry("logo-hook-first", "FIRST");
    const bytes = new Blob(["<svg/>"]);
    fetchMock.mockResolvedValue(respondWith(bytes));
    const { result } = renderHook(() => useLogoSettings([entry], entry.id, null));

    expect(result.current).toEqual({ logoMark: "", logoBlob: null });
    await waitFor(() => expect(result.current.logoBlob).toBe(bytes));
  });

  test("非法状态迁移:先发的请求后回来,不许覆盖当前选择", async () => {
    const staleEntry = makeLogoEntry("logo-hook-stale", "STALE");
    const currentEntry = makeLogoEntry("logo-hook-current", "CURRENT");
    const stale = makeDeferred<Response>();
    const current = makeDeferred<Response>();
    const staleBlob = new Blob(["stale"]);
    const currentBlob = new Blob(["current"]);
    fetchMock
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => current.promise);

    const { result, rerender } = renderHook(
      ({ logoId }: { logoId: string }) => useLogoSettings([staleEntry, currentEntry], logoId, null),
      { initialProps: { logoId: staleEntry.id } }
    );
    // 切到 currentEntry 后它的响应先落;stale 那条迟到时必须整条丢掉。
    rerender({ logoId: currentEntry.id });
    current.resolve(respondWith(currentBlob));
    await waitFor(() => expect(result.current.logoBlob).toBe(currentBlob));

    stale.resolve(respondWith(staleBlob));
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.logoBlob).toBe(currentBlob);
  });

  test("上游失败:解析途中卸载,迟到响应不再写组件状态", async () => {
    const entry = makeLogoEntry("logo-hook-unmount", "LATE");
    const pending = makeDeferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() => useLogoSettings([entry], entry.id, null));

    unmount();
    pending.resolve(respondWith(new Blob(["late"])));
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current).toEqual({ logoMark: "", logoBlob: null });
  });
});
