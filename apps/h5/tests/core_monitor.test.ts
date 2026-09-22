// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// core/monitor 用例:实例选择逻辑(启用/未启用分支)与 noop 幂等不抛错。
// 空值/零值边界落在载荷上(空串 kind/message、extra 含 0 值)。

const ENV_KEYS = ["RUM_ENDPOINT", "RUM_PID", "TRACK_ENDPOINT"] as const;

type EnvOverrides = Partial<Record<(typeof ENV_KEYS)[number], string>>;

function stubEnv(overrides: EnvOverrides = {}): void {
  for (const key of ENV_KEYS) {
    vi.stubEnv(key, overrides[key]);
  }
}

describe("getReporter(选择逻辑)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("未启用(缺 pid)返回 noopReporter", async () => {
    stubEnv({ RUM_ENDPOINT: "https://rum.example.com" });
    const { getReporter, noopReporter } = await import("../src/core/monitor");
    expect(getReporter()).toBe(noopReporter);
  });

  it("未启用(全缺配置)返回 noopReporter", async () => {
    stubEnv();
    const { getReporter, noopReporter } = await import("../src/core/monitor");
    expect(getReporter()).toBe(noopReporter);
  });

  it("启用(配置齐全)不抛错;骨架阶段无真实实现,启用分支同样回落 noop 实例", async () => {
    stubEnv({ RUM_ENDPOINT: "https://rum.example.com", RUM_PID: "pid-1" });
    const { getReporter, noopReporter } = await import("../src/core/monitor");
    const reporter = getReporter();
    expect(reporter).toBe(noopReporter);
    expect(() => reporter.captureMessage({ kind: "info", message: "hello" })).not.toThrow();
  });
});

describe("noopReporter(幂等不抛错)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.each([
    ["完整载荷", { kind: "render", message: "boom", stack: "Error: boom", extra: { route: "/" } }],
    ["空串消息", { kind: "", message: "" }],
    ["零值 extra", { kind: "global", message: "m", extra: { retry: 0 } }]
  ])("captureError(%s) 重复调用不抛错", async (_name, payload) => {
    const { noopReporter } = await import("../src/core/monitor");
    expect(() => {
      noopReporter.captureError(payload);
      noopReporter.captureError(payload);
      noopReporter.captureMessage(payload);
    }).not.toThrow();
  });

  it("可选项(stack/extra)缺省不抛错", async () => {
    const { noopReporter } = await import("../src/core/monitor");
    expect(() => noopReporter.captureError({ kind: "resource", message: "img" })).not.toThrow();
  });
});
