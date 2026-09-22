// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 三 sink 的 node 环境行为:console 输出格式、HTTP sink 的 SSR 守卫、RUM sink 的
// 注册门控(配置缺失不注册)。浏览器侧行为(sendBeacon/自定义事件)在
// tracking_browser.test.ts 覆盖。
import { createConsoleSink, createHttpSink, createRumSink } from "../src/tracking/sinks";

describe("createConsoleSink", () => {
  it("输出 [tracking] <事件名> 与载荷", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    createConsoleSink().send("page_view", { path: "/" });
    expect(info).toHaveBeenCalledWith("[tracking] page_view", { path: "/" });
    info.mockRestore();
  });

  it("payload 缺省时兜底为空对象", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    createConsoleSink().send("web_vitals");
    expect(info).toHaveBeenCalledWith("[tracking] web_vitals", {});
    info.mockRestore();
  });
});

describe("createHttpSink SSR 守卫(node,window 缺失)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("不发起任何请求(埋点是浏览器行为)", () => {
    createHttpSink("https://track.example.com").send("page_view", { path: "/" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("payload 缺省同样跳过,不抛错", () => {
    expect(() => createHttpSink("https://track.example.com").send("web_vitals")).not.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("createRumSink 注册门控", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("RUM_ENDPOINT/RUM_PID 任一缺失返回 null,不注册", () => {
    vi.stubEnv("RUM_ENDPOINT", "");
    vi.stubEnv("RUM_PID", "");
    expect(createRumSink()).toBeNull();
  });

  it("仅缺 endpoint 返回 null", () => {
    vi.stubEnv("RUM_ENDPOINT", "");
    vi.stubEnv("RUM_PID", "pid-1");
    expect(createRumSink()).toBeNull();
  });

  it("仅缺 pid 返回 null", () => {
    vi.stubEnv("RUM_ENDPOINT", "https://rum.example.com");
    vi.stubEnv("RUM_PID", "");
    expect(createRumSink()).toBeNull();
  });

  it("配置齐全时返回 rum sink(注册成功)", () => {
    vi.stubEnv("RUM_ENDPOINT", "https://rum.example.com");
    vi.stubEnv("RUM_PID", "pid-1");
    expect(createRumSink()?.name).toBe("rum");
  });
});
