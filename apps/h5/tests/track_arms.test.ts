// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isSampled } from "../src/core/track/arms";

// core/track/arms 用例(node 环境纯逻辑 + stub window 模拟浏览器分支):
// 六类边界覆盖——空值(payload/referrer 缺省)、零值(payload 含 0 原样保留)、越界(采样率 1.5/-0.5)、
// 权限缺失(TRACK_ENDPOINT 未配置不初始化)、网络失败(SDK 加载失败降级 console 不抛错)、
// 非法状态(SSR 分支静默丢弃、初始化幂等)。
// @arms/rum-browser 未纳入 h5 依赖,动态 import 用 hoisted 工厂打桩。
// 注意:vi.mock 工厂结果独立于 vi.resetModules 缓存,故模块成员用 getter/委托函数
// 按调用时 armsState 取值,"加载失败/形状异常"在用例内切换而非重建工厂。

const ENV_KEYS = ["TRACK_ENDPOINT", "H5_TRACK_SAMPLE_RATE"] as const;

type EnvOverrides = Partial<Record<(typeof ENV_KEYS)[number], string>>;

function stubEnv(overrides: EnvOverrides = {}): void {
  for (const key of ENV_KEYS) {
    vi.stubEnv(key, overrides[key]);
  }
}

const armsState = vi.hoisted(() => ({
  init: vi.fn(),
  sendEvent: vi.fn(),
  missingInit: false
}));

vi.mock("@arms/rum-browser", () => {
  const sendEvent = (...args: unknown[]) => armsState.sendEvent(...args);
  return {
    sendEvent,
    get default() {
      return armsState.missingInit
        ? {}
        : { init: (...args: unknown[]) => armsState.init(...args), sendEvent };
    }
  };
});

// 等待 loadSdk 的异步链(动态 import → init → dispatch 微任务)落定,用于"不发生"类断言。
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe("isSampled(采样判定,random 可注入)", () => {
  it.each([
    ["rate=1 全过(random 任意)", 1, 0.99, true],
    ["rate=0 全丢", 0, 0.01, false],
    ["上越界 1.5 视为全过", 1.5, 0.99, true],
    ["下越界 -0.5 视为全丢", -0.5, 0.01, false],
    ["(0,1) 命中(random<rate)保留", 0.5, 0.49, true],
    ["(0,1) 边界(random=rate)丢弃", 0.5, 0.5, false],
    ["(0,1) 未命中(random>rate)丢弃", 0.5, 0.51, false]
  ])("%s", (_name, rate, randomValue, expected) => {
    expect(isSampled(rate, () => randomValue)).toBe(expected);
  });
});

describe("createArmsTracker(浏览器分支,stub window)", () => {
  beforeEach(() => {
    vi.resetModules();
    armsState.missingInit = false;
    armsState.init.mockReset();
    armsState.sendEvent.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("启用 + 客户端:pageView 初始化 SDK 并上报 page_view 自定义事件(含 referrer)", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com", H5_TRACK_SAMPLE_RATE: "1" });
    vi.stubGlobal("window", {});
    const { createArmsTracker } = await import("../src/core/track/arms");
    createArmsTracker().pageView({ path: "/lottery", referrer: "https://ref.example.com" });
    await vi.waitFor(() => expect(armsState.sendEvent).toHaveBeenCalledTimes(1));
    expect(armsState.init).toHaveBeenCalledTimes(1);
    expect(armsState.init).toHaveBeenCalledWith({
      endpoint: "https://track.example.com",
      spaMode: "history"
    });
    expect(armsState.sendEvent).toHaveBeenCalledWith({
      event_type: "custom",
      type: "page_view",
      name: "/lottery",
      value: 0,
      properties: { referrer: "https://ref.example.com" }
    });
  });

  it("pageView 额外字段并入 properties;referrer 缺省不产生该键(空值边界)", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com", H5_TRACK_SAMPLE_RATE: "1" });
    vi.stubGlobal("window", {});
    const { createArmsTracker } = await import("../src/core/track/arms");
    createArmsTracker().pageView({ path: "/x", title: "抽奖" });
    await vi.waitFor(() => expect(armsState.sendEvent).toHaveBeenCalledTimes(1));
    expect(armsState.sendEvent).toHaveBeenCalledWith({
      event_type: "custom",
      type: "page_view",
      name: "/x",
      value: 0,
      properties: { title: "抽奖" }
    });
  });

  it("event 自定义事件:type/name 同事件名,payload 零值字段(0)原样保留", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com", H5_TRACK_SAMPLE_RATE: "1" });
    vi.stubGlobal("window", {});
    const { createArmsTracker } = await import("../src/core/track/arms");
    createArmsTracker().event("cta_click", { position: 0 });
    await vi.waitFor(() => expect(armsState.sendEvent).toHaveBeenCalledTimes(1));
    expect(armsState.sendEvent).toHaveBeenCalledWith({
      event_type: "custom",
      type: "cta_click",
      name: "cta_click",
      value: 0,
      properties: { position: 0 }
    });
  });

  it("event payload 缺省不抛错,properties 为 undefined(空值边界)", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com", H5_TRACK_SAMPLE_RATE: "1" });
    vi.stubGlobal("window", {});
    const { createArmsTracker } = await import("../src/core/track/arms");
    expect(() => createArmsTracker().event("share")).not.toThrow();
    await vi.waitFor(() => expect(armsState.sendEvent).toHaveBeenCalledTimes(1));
    expect(armsState.sendEvent).toHaveBeenCalledWith({
      event_type: "custom",
      type: "share",
      name: "share",
      value: 0,
      properties: undefined
    });
  });

  it("采样率 0:全丢,且不触发 SDK 加载(零网络行为)", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com", H5_TRACK_SAMPLE_RATE: "0" });
    vi.stubGlobal("window", {});
    const { createArmsTracker } = await import("../src/core/track/arms");
    const tracker = createArmsTracker();
    expect(() => {
      tracker.pageView({ path: "/x" });
      tracker.event("cta_click");
    }).not.toThrow();
    await flushAsync();
    expect(armsState.init).not.toHaveBeenCalled();
    expect(armsState.sendEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["上越界 '1.5' 截断为 1 → 全过", "1.5"],
    ["默认未配置 → 全过", undefined]
  ])("采样率%s", async (_name, rate) => {
    stubEnv(
      rate === undefined
        ? { TRACK_ENDPOINT: "https://track.example.com" }
        : { TRACK_ENDPOINT: "https://track.example.com", H5_TRACK_SAMPLE_RATE: rate }
    );
    vi.stubGlobal("window", {});
    const { createArmsTracker } = await import("../src/core/track/arms");
    createArmsTracker().event("cta_click");
    await vi.waitFor(() => expect(armsState.sendEvent).toHaveBeenCalledTimes(1));
  });

  it("采样率下越界 '-0.5' 截断为 0 → 全丢", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com", H5_TRACK_SAMPLE_RATE: "-0.5" });
    vi.stubGlobal("window", {});
    const { createArmsTracker } = await import("../src/core/track/arms");
    createArmsTracker().event("cta_click");
    await flushAsync();
    expect(armsState.init).not.toHaveBeenCalled();
    expect(armsState.sendEvent).not.toHaveBeenCalled();
  });

  it("采样率(0,1):可注入 random 决定去留", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com", H5_TRACK_SAMPLE_RATE: "0.5" });
    vi.stubGlobal("window", {});
    const { createArmsTracker } = await import("../src/core/track/arms");
    createArmsTracker({ random: () => 0.5 }).pageView({ path: "/dropped" });
    createArmsTracker({ random: () => 0.49 }).pageView({ path: "/kept" });
    await vi.waitFor(() => expect(armsState.sendEvent).toHaveBeenCalledTimes(1));
    expect(armsState.sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: "/kept" })
    );
  });

  it("endpoint 缺失(track 开关关):直接调用也不初始化、不上报(权限缺失边界)", async () => {
    stubEnv();
    vi.stubGlobal("window", {});
    const { createArmsTracker } = await import("../src/core/track/arms");
    createArmsTracker().pageView({ path: "/x" });
    await flushAsync();
    expect(armsState.init).not.toHaveBeenCalled();
    expect(armsState.sendEvent).not.toHaveBeenCalled();
  });

  it("SSR 分支(无 window):不初始化、静默丢弃、不抛错", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com", H5_TRACK_SAMPLE_RATE: "1" });
    const { createArmsTracker } = await import("../src/core/track/arms");
    expect(() => createArmsTracker().pageView({ path: "/x" })).not.toThrow();
    await flushAsync();
    expect(armsState.init).not.toHaveBeenCalled();
    expect(armsState.sendEvent).not.toHaveBeenCalled();
  });

  it("SDK 加载/初始化失败:console.error 记一次,后续事件降级 console 本地观测,不抛错", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com", H5_TRACK_SAMPLE_RATE: "1" });
    vi.stubGlobal("window", {});
    armsState.init.mockImplementation(() => {
      throw new Error("sdk network down");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { createArmsTracker } = await import("../src/core/track/arms");
    const tracker = createArmsTracker();
    expect(() => tracker.pageView({ path: "/x" })).not.toThrow();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(console.info).toHaveBeenCalledTimes(1));
    expect(armsState.sendEvent).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith("[track]", {
      name: "page_view",
      payload: { path: "/x" },
      timestamp: expect.any(Number)
    });
    expect(() => tracker.event("cta_click")).not.toThrow();
    await vi.waitFor(() => expect(console.info).toHaveBeenCalledTimes(2));
    expect(armsState.sendEvent).not.toHaveBeenCalled();
  });

  it("SDK 模块形状异常(缺 init):降级 console,不抛错", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com", H5_TRACK_SAMPLE_RATE: "1" });
    vi.stubGlobal("window", {});
    armsState.missingInit = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { createArmsTracker } = await import("../src/core/track/arms");
    expect(() => createArmsTracker().event("share")).not.toThrow();
    await vi.waitFor(() => expect(console.info).toHaveBeenCalledTimes(1));
    expect(armsState.init).not.toHaveBeenCalled();
    expect(armsState.sendEvent).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[track] ARMS SDK 模块形状异常,埋点降级为本地观测"
    );
  });

  it("初始化幂等:多次上报只 init 一次,事件逐条上报", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com", H5_TRACK_SAMPLE_RATE: "1" });
    vi.stubGlobal("window", {});
    const { createArmsTracker } = await import("../src/core/track/arms");
    const tracker = createArmsTracker();
    tracker.pageView({ path: "/a" });
    tracker.pageView({ path: "/b" });
    tracker.event("cta_click");
    await vi.waitFor(() => expect(armsState.sendEvent).toHaveBeenCalledTimes(3));
    expect(armsState.init).toHaveBeenCalledTimes(1);
  });
});
