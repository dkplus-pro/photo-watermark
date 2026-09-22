// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// RUM SSR 守卫(node 环境,无 window):env 再齐全也不初始化(docs/site.md「监控」)。
const h = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock("@arms/rum-browser", () => ({ default: { init: h.init } }));

describe("initRum SSR 守卫(node 环境)", () => {
  beforeEach(() => {
    vi.resetModules();
    h.init.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("env 齐全但 window 缺失时不初始化", async () => {
    vi.stubEnv("RUM_ENDPOINT", "https://rum.example.com");
    vi.stubEnv("RUM_PID", "pid-1");
    const { initRum } = await import("../../src/config/rum");
    await expect(initRum()).resolves.toBe(false);
    expect(h.init).not.toHaveBeenCalled();
  });
});
