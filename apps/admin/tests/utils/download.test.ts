import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import {
  OBJECT_URL_REVOKE_DELAY,
  downloadBlob,
  revokeObjectUrlLater
} from "../../src/utils/download";

/**
 * 下载触发单测。
 *
 * 「权限缺失」与「网络失败」两类边界不适用:本模块不发请求、不需要任何浏览器授权
 * (决策 D5 选 anchor 下载正是为了绕开「允许下载多个文件」这类权限),
 * 因此跨端差异只体现在两条时序守卫上——anchor 必须先入 DOM 再点击、URL 必须延迟回收。
 *
 * tests/setup.ts 里的 URL.createObjectURL shim 是无计数版本,
 * 需要断言调用次数与参数,故每个用例自带 vi.spyOn 覆盖它。
 */

const MOCK_URL = "blob:export-mock";

const exportBlob = (content: string = "zip-bytes"): Blob =>
  new Blob([content], { type: "application/zip" });

describe("downloadBlob", () => {
  let calls: string[] = [];
  let parents: Node[] = [];
  let connectedAtClick: boolean[] = [];
  let createSpy: MockInstance;
  let revokeSpy: MockInstance;
  let clickSpy: MockInstance;
  let appendSpy: MockInstance;
  let elementSpy: MockInstance;

  const createdAnchor = (which = 0): HTMLAnchorElement =>
    elementSpy.mock.results[which]?.value as HTMLAnchorElement;

  /** 临时把 document 上的 body/documentElement 换成 null(own 属性遮蔽原型 getter)。 */
  const hideDocumentNode = (key: "body" | "documentElement"): void => {
    Object.defineProperty(document, key, { configurable: true, get: () => null });
  };
  const restoreDocumentNode = (key: "body" | "documentElement"): void => {
    Reflect.deleteProperty(document, key);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    parents = [];
    connectedAtClick = [];
    createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue(MOCK_URL);
    revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    // 桩掉真实点击:jsdom 会因 blob: 导航抛 "Not implemented",噪音会盖住真实失败。
    clickSpy = vi.spyOn(HTMLElement.prototype, "click").mockImplementation(() => {
      calls.push("click");
      // 硬规则 2 的证据:点击发生的那一刻 anchor 必须在文档里
      const anchor = createdAnchor(elementSpy.mock.results.length - 1);
      connectedAtClick.push(Boolean(anchor?.isConnected));
    });
    const originalAppendChild = Node.prototype.appendChild;
    appendSpy = vi.spyOn(Node.prototype, "appendChild").mockImplementation(function (
      this: Node,
      node: Node
    ): Node {
      calls.push("appendChild");
      parents.push(this);
      return originalAppendChild.call(this, node);
    });
    elementSpy = vi.spyOn(document, "createElement");
  });

  afterEach(() => {
    restoreDocumentNode("body");
    restoreDocumentNode("documentElement");
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("按 appendChild → click 的顺序走,download 属性就是传入的文件名", () => {
    downloadBlob(exportBlob(), "frame-export-2026-09-22.zip");

    expect(calls).toEqual(["appendChild", "click"]);
    expect(connectedAtClick).toEqual([true]);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const anchor = createdAnchor();
    expect(anchor.download).toBe("frame-export-2026-09-22.zip");
    expect(anchor.getAttribute("href")).toBe(MOCK_URL);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("硬规则 2:click 那一刻 anchor 一定挂在文档里(Firefox 不认游离节点)", () => {
    downloadBlob(exportBlob("one"), "one.zip");
    hideDocumentNode("body");
    downloadBlob(exportBlob("two"), "two.zip");
    restoreDocumentNode("body");
    downloadBlob(exportBlob("three"), "three.zip");

    // 三次点击全部在 DOM 内(第二次走的是 documentElement 兜底,同样算挂载)
    expect(connectedAtClick).toEqual([true, true, true]);
    expect(parents).toEqual([document.body, document.documentElement, document.body]);
  });

  it("硬规则 1:默认回收延迟必须大于 0,任何时点都不许点击后立刻 revoke", () => {
    expect(OBJECT_URL_REVOKE_DELAY).toBeGreaterThan(0);

    downloadBlob(exportBlob(), "a.zip");
    // 同步阶段与「时钟原地/走 1 毫秒」都不该回收:把延迟改成 0 或立即 revoke 的实现会在这里红
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it("点击之后 anchor 已从 DOM 移除(不留游离节点)", () => {
    downloadBlob(exportBlob(), "a.zip");

    const anchor = createdAnchor();
    expect(anchor.isConnected).toBe(false);
    expect(document.body?.contains(anchor)).toBe(false);
    expect(document.documentElement.contains(anchor)).toBe(false);
  });

  it("URL 在 30s 之前不回收(下载还在写盘),到期立刻回收", () => {
    downloadBlob(exportBlob(), "a.zip");
    expect(OBJECT_URL_REVOKE_DELAY).toBe(30_000);

    vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY - 1);
    expect(revokeSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(MOCK_URL);
  });

  it("空 Blob 也照常触发下载(空产物由上游保证,工具层不做业务校验)", () => {
    const empty = new Blob([], { type: "application/zip" });
    expect(empty.size).toBe(0);

    downloadBlob(empty, "empty.zip");

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["appendChild", "click"]);
    expect(createdAnchor().download).toBe("empty.zip");
  });

  it("document.body 缺失时退回 documentElement,下载流程不受影响", () => {
    hideDocumentNode("body");

    expect(() => downloadBlob(exportBlob(), "a.zip")).not.toThrow();

    expect(calls).toEqual(["appendChild", "click"]);
    expect(parents[0]).toBe(document.documentElement);
  });

  it("body 与 documentElement 都缺失时静默返回并同步回收 URL", () => {
    hideDocumentNode("body");
    hideDocumentNode("documentElement");

    expect(() => downloadBlob(exportBlob(), "a.zip")).not.toThrow();

    expect(calls).toEqual([]);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(MOCK_URL);
  });

  it("appendChild 自身抛错时也静默返回(不向上炸掉导出流程)", () => {
    appendSpy.mockImplementation(() => {
      throw new Error("DOM 挂载失败");
    });

    expect(() => downloadBlob(exportBlob(), "a.zip")).not.toThrow();
    expect(clickSpy).not.toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it("连点两次导出会创建两个独立 anchor 与两条待回收 URL", () => {
    downloadBlob(exportBlob("one"), "one.zip");
    downloadBlob(exportBlob("two"), "two.zip");

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(["appendChild", "click", "appendChild", "click"]);
    expect(elementSpy).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY);
    expect(revokeSpy).toHaveBeenCalledTimes(2);
  });
});

describe("revokeObjectUrlLater", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("默认延迟就是 OBJECT_URL_REVOKE_DELAY", () => {
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);

    revokeObjectUrlLater("blob:default");
    vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY - 1);
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeSpy).toHaveBeenCalledWith("blob:default");
  });

  it("可指定自定义延迟,提前到点不提前回收", () => {
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);

    revokeObjectUrlLater("blob:custom", 5_000);
    vi.advanceTimersByTime(4_999);
    expect(revokeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });
});
