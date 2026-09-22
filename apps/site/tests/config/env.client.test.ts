import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 浏览器分支边界(jsdom,window 存在):SITE_API_BASE/TRACK_ENDPOINT 是服务端专属,
// 客户端分支不读 process.env(与 src/api/client.ts 双端 baseURL 规则一致),即使
// process.env 有值也走默认值;RUM_* 为客户端可见变量,双端可读。
describe("defaultEnv 浏览器分支", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("服务端专属变量被忽略,RUM_* 仍可读", async () => {
    vi.stubEnv("SITE_API_BASE", "https://api.example.com");
    vi.stubEnv("TRACK_ENDPOINT", "https://track.example.com");
    vi.stubEnv("RUM_ENDPOINT", "https://rum.example.com");
    vi.stubEnv("RUM_PID", "pid-1");
    const { siteEnv } = await import("../../src/config/env");
    expect(siteEnv.siteApiBase).toBe("http://127.0.0.1:8080");
    expect(siteEnv.trackEndpoint).toBe("");
    expect(siteEnv.rumEndpoint).toBe("https://rum.example.com");
    expect(siteEnv.rumPid).toBe("pid-1");
  });
});
