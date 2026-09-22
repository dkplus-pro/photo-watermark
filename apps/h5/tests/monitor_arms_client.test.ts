// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportPayload } from "../src/core/monitor";
import { createArmsReporter } from "../src/core/monitor/arms";

// createArmsReporter 客户端路径(jsdom,window 存在):SDK 加载失败/形状异常降级、
// 捕获转发 payload 形状、初始化幂等、init 未完成补发、采样放行、getReporter 客户端分支。
// endpoint/pid 经 options 显式注入,不依赖 process.env。

const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const ENDPOINT = "https://rum.example.com";
const PID = "pid-1";
const ERROR_PAYLOAD: ReportPayload = {
  kind: "js_error",
  message: "boom",
  stack: "Error: boom",
  extra: { route: "/" }
};
const MESSAGE_PAYLOAD: ReportPayload = { kind: "info", message: "hello" };

function createFakeSdk() {
  const init = vi.fn(async () => undefined);
  const sendException = vi.fn();
  const sendCustom = vi.fn();
  return { sdk: { init, sendException, sendCustom }, init, sendException, sendCustom };
}

type FakeSdk = ReturnType<typeof createFakeSdk>["sdk"];

describe("createArmsReporter(客户端路径)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("加载成功:captureError/captureMessage 按 ARMS 事件形状转发", async () => {
    const fake = createFakeSdk();
    const loader = vi.fn(async () => fake.sdk);
    const reporter = createArmsReporter({ endpoint: ENDPOINT, pid: PID, loadSdk: loader });

    reporter.captureError(ERROR_PAYLOAD);
    reporter.captureMessage(MESSAGE_PAYLOAD);
    await flush();

    expect(fake.init).toHaveBeenCalledWith({
      pid: PID,
      endpoint: ENDPOINT,
      version: expect.any(String),
      spaMode: "history"
    });
    expect(fake.sendException).toHaveBeenCalledWith({
      source: "h5",
      type: "error",
      name: "js_error",
      message: "boom",
      stack: "Error: boom"
    });
    expect(fake.sendCustom).toHaveBeenCalledWith({
      type: "message",
      name: "info",
      group: "hello",
      value: 1
    });
  });

  it("初始化幂等:并发捕获共享一次加载与一次 init", async () => {
    const fake = createFakeSdk();
    const loader = vi.fn(async () => fake.sdk);
    const reporter = createArmsReporter({ endpoint: ENDPOINT, pid: PID, loadSdk: loader });

    reporter.captureError(ERROR_PAYLOAD);
    reporter.captureError(ERROR_PAYLOAD);
    reporter.captureMessage(MESSAGE_PAYLOAD);
    await flush();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(fake.init).toHaveBeenCalledTimes(1);
    expect(fake.sendException).toHaveBeenCalledTimes(2);
    expect(fake.sendCustom).toHaveBeenCalledTimes(1);
  });

  it("SDK 加载失败:不抛错、降级 no-op、不重试(仅日志一次)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loader = vi.fn(async () => {
      throw new Error("network down");
    });
    const reporter = createArmsReporter({ endpoint: ENDPOINT, pid: PID, loadSdk: loader });

    expect(() => reporter.captureError(ERROR_PAYLOAD)).not.toThrow();
    await flush();
    expect(consoleError).toHaveBeenCalledTimes(1);

    reporter.captureError(ERROR_PAYLOAD);
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("SDK 模块形状异常(缺 sendException):降级 no-op、不抛错", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { init: vi.fn(async () => undefined) } as unknown as FakeSdk;
    const loader = vi.fn(async () => broken);
    const reporter = createArmsReporter({ endpoint: ENDPOINT, pid: PID, loadSdk: loader });

    expect(() => reporter.captureError(ERROR_PAYLOAD)).not.toThrow();
    await flush();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("loader 返回 null:静默丢弃、不抛错", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loader = vi.fn(async () => null);
    const reporter = createArmsReporter({ endpoint: ENDPOINT, pid: PID, loadSdk: loader });

    expect(() => reporter.captureError(ERROR_PAYLOAD)).not.toThrow();
    await flush();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("init 完成前的捕获在初始化后补发,不丢失", async () => {
    const fake = createFakeSdk();
    let resolveLoad!: (sdk: FakeSdk) => void;
    const loader = vi.fn(
      () =>
        new Promise<FakeSdk>((resolve) => {
          resolveLoad = resolve;
        })
    );
    const reporter = createArmsReporter({ endpoint: ENDPOINT, pid: PID, loadSdk: loader });

    reporter.captureError(ERROR_PAYLOAD);
    await flush();
    expect(fake.sendException).not.toHaveBeenCalled();

    resolveLoad(fake.sdk);
    await flush();
    expect(fake.sendException).toHaveBeenCalledTimes(1);
  });

  it("采样放行(rate=0.5,random 命中):正常加载并转发", async () => {
    const fake = createFakeSdk();
    const loader = vi.fn(async () => fake.sdk);
    const kept = createArmsReporter({
      endpoint: ENDPOINT,
      pid: PID,
      sampleRate: 0.5,
      random: () => 0.1,
      loadSdk: loader
    });
    kept.captureError(ERROR_PAYLOAD);
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(fake.sendException).toHaveBeenCalledTimes(1);

    const dropped = createArmsReporter({
      endpoint: ENDPOINT,
      pid: PID,
      sampleRate: 0.5,
      random: () => 0.9,
      loadSdk: loader
    });
    dropped.captureError(ERROR_PAYLOAD);
    await flush();
    expect(fake.sendException).toHaveBeenCalledTimes(1);
  });
});

describe("getReporter(客户端选择逻辑)", () => {
  beforeEach(() => {
    // monitor/index → arms → config/feature 的 features 在模块加载时求值,
    // stubEnv 必须先于动态 import,且需重置先前静态 import 缓存的模块图。
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("启用(配置齐全)且客户端环境返回 ARMS 实现体(非 noop)", async () => {
    vi.stubEnv("RUM_ENDPOINT", ENDPOINT);
    vi.stubEnv("RUM_PID", PID);
    const { getReporter, noopReporter } = await import("../src/core/monitor");
    const reporter = getReporter();
    expect(reporter).not.toBe(noopReporter);
    expect(typeof reporter.captureError).toBe("function");
    expect(typeof reporter.captureMessage).toBe("function");
    // 注意:此处只断言身份,不调用 captureError——单例绑定真实动态 import,加载行为
    // 由上面的 createArmsReporter 注入用例覆盖。
  });
});
