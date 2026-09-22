import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// RUM 初始化守卫(docs/quality-and-site-plan.md 阶段 18 用例清单):
// env RUM_ENDPOINT/RUM_PID 任一缺失不初始化;window 缺失(SSR)不初始化;配置齐全才初始化。
const h = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock("@arms/rum-browser", () => ({ default: { init: h.init } }));

describe("readRumConfig", () => {
  it("endpoint 与 pid 齐全返回配置", async () => {
    const { readRumConfig } = await import("../../src/config/rum");
    expect(readRumConfig({ RUM_ENDPOINT: "https://rum.example.com", RUM_PID: "pid-1" })).toEqual({
      pid: "pid-1",
      endpoint: "https://rum.example.com",
      version: expect.any(String)
    });
  });

  it.each([
    ["缺 endpoint", { RUM_PID: "pid-1" }],
    ["缺 pid", { RUM_ENDPOINT: "https://rum.example.com" }],
    ["全缺", {}]
  ])("%s 返回 null", async (_name, env) => {
    const { readRumConfig } = await import("../../src/config/rum");
    expect(readRumConfig(env)).toBeNull();
  });
});

describe("initRum(jsdom,window 存在)", () => {
  beforeEach(() => {
    vi.resetModules();
    h.init.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("配置齐全时动态初始化 SDK(spaMode history)", async () => {
    vi.stubEnv("RUM_ENDPOINT", "https://rum.example.com");
    vi.stubEnv("RUM_PID", "pid-1");
    const { initRum } = await import("../../src/config/rum");
    await expect(initRum()).resolves.toBe(true);
    expect(h.init).toHaveBeenCalledWith(
      expect.objectContaining({
        pid: "pid-1",
        endpoint: "https://rum.example.com",
        spaMode: "history"
      })
    );
  });

  it("重复调用幂等,不重复初始化", async () => {
    vi.stubEnv("RUM_ENDPOINT", "https://rum.example.com");
    vi.stubEnv("RUM_PID", "pid-1");
    const { initRum } = await import("../../src/config/rum");
    await initRum();
    await expect(initRum()).resolves.toBe(false);
    expect(h.init).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["缺 endpoint", { RUM_PID: "pid-1" }],
    ["缺 pid", { RUM_ENDPOINT: "https://rum.example.com" }]
  ])("%s 时不初始化", async (_name, env) => {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    const { initRum } = await import("../../src/config/rum");
    await expect(initRum()).resolves.toBe(false);
    expect(h.init).not.toHaveBeenCalled();
  });
});

// SDK 加载异常分支(任务卡 6.1 覆盖率补缺,网络失败类边界):SDK 无 init 或动态加载
// 抛错时只记日志并返回 false,不允许影响站点功能。vi.doMock 按用例覆盖 hoisted 桩。
describe("initRum SDK 加载异常分支", () => {
  beforeEach(() => {
    vi.resetModules();
    h.init.mockClear();
  });

  afterEach(() => {
    vi.doUnmock("@arms/rum-browser");
    vi.unstubAllEnvs();
  });

  it("SDK 加载异常(缺 init)时跳过初始化并记日志", async () => {
    vi.doMock("@arms/rum-browser", () => ({ default: {} }));
    vi.stubEnv("RUM_ENDPOINT", "https://rum.example.com");
    vi.stubEnv("RUM_PID", "pid-1");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { initRum } = await import("../../src/config/rum");
      await expect(initRum()).resolves.toBe(false);
      expect(h.init).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith("RUM SDK 加载异常,跳过初始化");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("SDK 动态加载抛错时静默降级,返回 false 不向上抛", async () => {
    vi.doMock("@arms/rum-browser", () => Promise.reject(new Error("sdk chunk load failed")));
    vi.stubEnv("RUM_ENDPOINT", "https://rum.example.com");
    vi.stubEnv("RUM_PID", "pid-1");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { initRum } = await import("../../src/config/rum");
      await expect(initRum()).resolves.toBe(false);
      expect(h.init).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith("RUM 初始化失败", expect.any(Error));
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
