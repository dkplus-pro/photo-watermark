// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// core/track 用例:选择逻辑(未启用 no-op / 启用 ARMS 远端实现,见 track_arms.test.ts)、
// console 输出事件形状(2.B 起保留为 SDK 加载失败的降级兜底)。
// 边界:空值(payload 缺省/undefined)、零值(payload 含 0 不被吞)。

const ENV_KEYS = ["TRACK_ENDPOINT"] as const;

type EnvOverrides = Partial<Record<(typeof ENV_KEYS)[number], string>>;

function stubEnv(overrides: EnvOverrides = {}): void {
  for (const key of ENV_KEYS) {
    vi.stubEnv(key, overrides[key]);
  }
}

describe("getTracker(选择逻辑)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("未启用(TRACK_ENDPOINT 缺失)返回 noopTracker,无任何 console 输出", async () => {
    stubEnv();
    const { getTracker, noopTracker } = await import("../src/core/track");
    const tracker = getTracker();
    expect(tracker).toBe(noopTracker);
    tracker.pageView({ path: "/" });
    tracker.event("cta_click");
    expect(console.info).not.toHaveBeenCalled();
  });

  it("启用(TRACK_ENDPOINT 已配置)返回 ARMS 远端实现(阶段 2.B 接入,非 console/noop)", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com" });
    const { getTracker, consoleTracker, noopTracker } = await import("../src/core/track");
    const tracker = getTracker();
    expect(tracker).not.toBe(consoleTracker);
    expect(tracker).not.toBe(noopTracker);
  });
});

describe("consoleTracker(事件形状)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("pageView 输出 page_view 事件:name/payload/timestamp 形状完整", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com" });
    const { consoleTracker } = await import("../src/core/track");
    consoleTracker.pageView({ path: "/lottery" });
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith("[track]", {
      name: "page_view",
      payload: { path: "/lottery" },
      timestamp: expect.any(Number)
    });
  });

  it("event 输出自定义事件名,payload 零值字段(0)原样保留", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com" });
    const { consoleTracker } = await import("../src/core/track");
    consoleTracker.event("cta_click", { position: 0 });
    expect(console.info).toHaveBeenCalledWith("[track]", {
      name: "cta_click",
      payload: { position: 0 },
      timestamp: expect.any(Number)
    });
  });

  it("payload 缺省(空值边界)输出 payload undefined,不抛错", async () => {
    stubEnv({ TRACK_ENDPOINT: "https://track.example.com" });
    const { consoleTracker } = await import("../src/core/track");
    expect(() => {
      consoleTracker.pageView();
      consoleTracker.event("share");
    }).not.toThrow();
    expect(console.info).toHaveBeenNthCalledWith(1, "[track]", {
      name: "page_view",
      payload: undefined,
      timestamp: expect.any(Number)
    });
    expect(console.info).toHaveBeenNthCalledWith(2, "[track]", {
      name: "share",
      payload: undefined,
      timestamp: expect.any(Number)
    });
  });
});

describe("noopTracker(幂等不抛错)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("pageView/event 调用不抛错、无返回", async () => {
    const { noopTracker } = await import("../src/core/track");
    expect(() => {
      noopTracker.pageView();
      noopTracker.pageView({ path: "/" });
      noopTracker.event("");
      noopTracker.event("cta_click", { position: 0 });
    }).not.toThrow();
  });
});
