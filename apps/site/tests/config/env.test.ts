// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// env 配置坑(src/config/env.ts):默认值、非法值启动报错、siteEnv 单例派生。
// node 环境(window 缺失)走 defaultEnv 服务端分支,可覆盖 SITE_API_BASE/TRACK_ENDPOINT。
describe("loadSiteEnv", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("全缺省时返回默认值(RUM/TRACK 关闭,SITE_API_BASE 指向本机 Go server)", async () => {
    const { loadSiteEnv } = await import("../../src/config/env");
    expect(loadSiteEnv({})).toEqual({
      siteApiBase: "http://127.0.0.1:8080",
      rumEndpoint: "",
      rumPid: "",
      trackEndpoint: ""
    });
  });

  it("显式配置逐项透传", async () => {
    const { loadSiteEnv } = await import("../../src/config/env");
    expect(
      loadSiteEnv({
        SITE_API_BASE: "https://api.example.com",
        RUM_ENDPOINT: "https://rum.example.com",
        RUM_PID: "pid-1",
        TRACK_ENDPOINT: "https://track.example.com"
      })
    ).toEqual({
      siteApiBase: "https://api.example.com",
      rumEndpoint: "https://rum.example.com",
      rumPid: "pid-1",
      trackEndpoint: "https://track.example.com"
    });
  });

  it("RUM/TRACK 槽位空串视同未配置(source.define 未配置时内联为空串)", async () => {
    const { loadSiteEnv } = await import("../../src/config/env");
    expect(loadSiteEnv({ RUM_ENDPOINT: "", RUM_PID: "", TRACK_ENDPOINT: "" })).toEqual({
      siteApiBase: "http://127.0.0.1:8080",
      rumEndpoint: "",
      rumPid: "",
      trackEndpoint: ""
    });
  });

  it.each([
    ["SITE_API_BASE", { SITE_API_BASE: "not-a-url" }],
    ["RUM_ENDPOINT", { RUM_ENDPOINT: "rum.example.com" }],
    ["TRACK_ENDPOINT", { TRACK_ENDPOINT: "http://" }]
  ])("非法 %s 抛错且错误信息带字段名", async (field, source) => {
    const { loadSiteEnv } = await import("../../src/config/env");
    expect(() => loadSiteEnv(source)).toThrow(field);
  });
});

describe("siteEnv 单例(模块加载时校验)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("派生自 process.env(stubEnv 后动态 import)", async () => {
    vi.stubEnv("SITE_API_BASE", "https://api.example.com");
    vi.stubEnv("RUM_ENDPOINT", "https://rum.example.com");
    vi.stubEnv("RUM_PID", "pid-1");
    const { siteEnv } = await import("../../src/config/env");
    expect(siteEnv).toEqual({
      siteApiBase: "https://api.example.com",
      rumEndpoint: "https://rum.example.com",
      rumPid: "pid-1",
      trackEndpoint: ""
    });
  });

  it("非法 env 在模块加载时即抛错(SSR 启动失败)", async () => {
    vi.stubEnv("RUM_ENDPOINT", "not-a-url");
    await expect(import("../../src/config/env")).rejects.toThrow("RUM_ENDPOINT");
  });
});
