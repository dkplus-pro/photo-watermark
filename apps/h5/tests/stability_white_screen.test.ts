// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WHITE_SCREEN_TIMEOUT_MS,
  isRootEmpty,
  startWhiteScreenCheck
} from "../src/core/stability";

// 白屏检测用例(jsdom):判定纯函数 isRootEmpty 的空/非空/子节点全隐藏/自渲染边界,
// 以及 startWhiteScreenCheck 的注入定时器流程(白屏上报/有内容不上报/取消/缺省参数)。
// 上报断言经 vi.mock monitor 接口注入 fake reporter。

const reporterState = vi.hoisted(() => ({
  captureError: vi.fn(),
  captureMessage: vi.fn()
}));

vi.mock("../src/core/monitor", () => ({
  getReporter: () => reporterState
}));

function mountRoot(): HTMLElement {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  return root;
}

describe("isRootEmpty(白屏判定纯函数)", () => {
  it("根节点缺失(null)视为白屏(空值边界)", () => {
    expect(isRootEmpty(null)).toBe(true);
  });

  it("空根节点(无任何子节点)视为白屏(零值边界)", () => {
    expect(isRootEmpty(document.createElement("div"))).toBe(true);
  });

  it("仅空白文本视为白屏(空白折叠不算内容)", () => {
    const el = document.createElement("div");
    el.append("   \n\t ");
    expect(isRootEmpty(el)).toBe(true);
  });

  it("有直接文本视为非白屏", () => {
    const el = document.createElement("div");
    el.append("活动进行中");
    expect(isRootEmpty(el)).toBe(false);
  });

  it("子元素携带文本视为非白屏(递归可见内容)", () => {
    const el = document.createElement("div");
    const child = document.createElement("p");
    child.append("活动进行中");
    el.appendChild(child);
    expect(isRootEmpty(el)).toBe(false);
  });

  it("子节点全部隐藏视为白屏", () => {
    const el = document.createElement("div");
    const child = document.createElement("p");
    child.append("活动进行中");
    child.style.display = "none";
    el.appendChild(child);
    expect(isRootEmpty(el)).toBe(true);
  });

  it("隐藏与可见子节点并存视为非白屏(有可见内容即非白屏)", () => {
    const el = document.createElement("div");
    const hidden = document.createElement("p");
    hidden.style.display = "none";
    const visible = document.createElement("p");
    visible.append("可见内容");
    el.append(hidden, visible);
    expect(isRootEmpty(el)).toBe(false);
  });

  it("根节点自身隐藏视为白屏", () => {
    const el = document.createElement("div");
    el.append("活动进行中");
    el.style.visibility = "hidden";
    expect(isRootEmpty(el)).toBe(true);
  });

  it("纯图片子节点视为非白屏(自渲染元素防误报)", () => {
    const el = document.createElement("div");
    el.appendChild(document.createElement("img"));
    expect(isRootEmpty(el)).toBe(false);
  });
});

describe("startWhiteScreenCheck(检测流程)", () => {
  beforeEach(() => {
    reporterState.captureMessage.mockClear();
    reporterState.captureError.mockClear();
  });

  afterEach(() => {
    document.getElementById("root")?.remove();
  });

  it("超时后根节点为空 → captureMessage(kind=white_screen,extra 含选择器与超时)", () => {
    mountRoot();
    let fire: (() => void) | null = null;
    const scheduleTimer = vi.fn((callback: () => void) => {
      fire = callback;
      return 1;
    });
    startWhiteScreenCheck({ scheduleTimer, timeoutMs: 1500 });
    fire?.();
    expect(reporterState.captureMessage).toHaveBeenCalledTimes(1);
    const payload = reporterState.captureMessage.mock.calls[0][0];
    expect(payload.kind).toBe("white_screen");
    expect(payload.extra).toEqual({ rootSelector: "#root", timeoutMs: 1500 });
    expect(reporterState.captureError).not.toHaveBeenCalled();
  });

  it("超时后根节点有内容 → 不上报(仅检测不阻断)", () => {
    const root = mountRoot();
    root.append("活动进行中");
    let fire: (() => void) | null = null;
    const scheduleTimer = vi.fn((callback: () => void) => {
      fire = callback;
      return 1;
    });
    startWhiteScreenCheck({ scheduleTimer });
    fire?.();
    expect(reporterState.captureMessage).not.toHaveBeenCalled();
    expect(reporterState.captureError).not.toHaveBeenCalled();
  });

  it("取消函数:定时器触发前取消则不再检测,且不再上报", () => {
    mountRoot();
    let fire: (() => void) | null = null;
    let cleared = false;
    const scheduleTimer = vi.fn((callback: () => void) => {
      fire = callback;
      return 7;
    });
    // 模拟真实定时器语义:clear 后句柄作废,回调不再执行。
    const cancelTimer = vi.fn(() => {
      cleared = true;
    });
    const cancel = startWhiteScreenCheck({ scheduleTimer, cancelTimer });
    cancel();
    expect(cancelTimer).toHaveBeenCalledWith(7);
    if (!cleared) {
      fire?.();
    }
    expect(reporterState.captureMessage).not.toHaveBeenCalled();
  });

  it("取消幂等:定时器已触发后再取消,不再重复调用 cancelTimer", () => {
    mountRoot();
    let fire: (() => void) | null = null;
    const scheduleTimer = vi.fn((callback: () => void) => {
      fire = callback;
      return 7;
    });
    const cancelTimer = vi.fn();
    const cancel = startWhiteScreenCheck({ scheduleTimer, cancelTimer });
    fire?.();
    expect(reporterState.captureMessage).toHaveBeenCalledTimes(1);
    cancel();
    expect(cancelTimer).not.toHaveBeenCalled();
  });

  it("缺省参数:rootSelector=#root、timeoutMs=3000(默认 3s 配置坑)", () => {
    let fire: (() => void) | null = null;
    const scheduleTimer = vi.fn((callback: () => void, ms: number) => {
      fire = callback;
      return ms;
    });
    startWhiteScreenCheck({ scheduleTimer });
    expect(scheduleTimer).toHaveBeenCalledTimes(1);
    expect(scheduleTimer.mock.calls[0][1]).toBe(DEFAULT_WHITE_SCREEN_TIMEOUT_MS);
    expect(DEFAULT_WHITE_SCREEN_TIMEOUT_MS).toBe(3000);
    // #root 不存在 → querySelector 为 null → 视为白屏上报。
    fire?.();
    const payload = reporterState.captureMessage.mock.calls[0][0];
    expect(payload.extra).toEqual({ rootSelector: "#root", timeoutMs: 3000 });
  });
});
