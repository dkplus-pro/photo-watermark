// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config/env + config/feature 用例(纯逻辑,node 环境,照抄 site rum 用例范式):
// env 模块在加载期读一次 env,每个用例先 stub 再动态 import。
// 覆盖六类边界中的:空值(未配置/空串/纯空白)、零值(采样率 0)、越界(采样率 >1/<0)。

const ENV_KEYS = [
  "H5_API_BASE",
  "RUM_ENDPOINT",
  "RUM_PID",
  "TRACK_ENDPOINT",
  "H5_MONITOR_SAMPLE_RATE",
  "H5_TRACK_SAMPLE_RATE"
] as const;

type EnvOverrides = Partial<Record<(typeof ENV_KEYS)[number], string>>;

// 全部键显式 stub(缺省 undefined),避免开发机本机 env 污染用例。
function stubEnv(overrides: EnvOverrides = {}): void {
  for (const key of ENV_KEYS) {
    vi.stubEnv(key, overrides[key]);
  }
}

describe("env(SSR 分支,node 环境无 window)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("全部未配置时返回默认值", async () => {
    stubEnv();
    const { env } = await import("../src/config/env");
    expect(env).toEqual({
      apiBase: "http://127.0.0.1:18085",
      rumEndpoint: "",
      rumPid: "",
      trackEndpoint: "",
      monitorSampleRate: 1,
      trackSampleRate: 1
    });
  });

  it("注入值全部生效", async () => {
    stubEnv({
      H5_API_BASE: "http://api.example.com",
      RUM_ENDPOINT: "https://rum.example.com",
      RUM_PID: "pid-1",
      TRACK_ENDPOINT: "https://track.example.com",
      H5_MONITOR_SAMPLE_RATE: "0.5",
      H5_TRACK_SAMPLE_RATE: "0"
    });
    const { env } = await import("../src/config/env");
    expect(env.apiBase).toBe("http://api.example.com");
    expect(env.rumEndpoint).toBe("https://rum.example.com");
    expect(env.rumPid).toBe("pid-1");
    expect(env.trackEndpoint).toBe("https://track.example.com");
    expect(env.monitorSampleRate).toBe(0.5);
    expect(env.trackSampleRate).toBe(0);
  });

  it.each([
    ["空串", ""],
    ["纯空白", "   "]
  ])("endpoint 为%s时视为未配置(空值边界)", async (_name, value) => {
    stubEnv({ RUM_ENDPOINT: value, TRACK_ENDPOINT: value });
    const { env } = await import("../src/config/env");
    expect(env.rumEndpoint).toBe("");
    expect(env.trackEndpoint).toBe("");
  });

  it.each([
    ["上越界截断为 1", "1.5", 1],
    ["下越界截断为 0", "-0.5", 0],
    ["零值 0", "0", 0],
    ["非数字回退默认 1", "abc", 1],
    ["空白回退默认 1", "  ", 1],
    ["Infinity 截断为 1", "Infinity", 1],
    ["-Infinity 截断为 0", "-Infinity", 0]
  ])("采样率%s", async (_name, raw, expected) => {
    stubEnv({ H5_MONITOR_SAMPLE_RATE: raw, H5_TRACK_SAMPLE_RATE: raw });
    const { env } = await import("../src/config/env");
    expect(env.monitorSampleRate).toBe(expected);
    expect(env.trackSampleRate).toBe(expected);
  });
});

describe("env(浏览器分支,stub window)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("apiBase 恒为空串(同源相对路径),即使注入了 H5_API_BASE", async () => {
    vi.stubGlobal("window", {});
    stubEnv({ H5_API_BASE: "http://api.example.com" });
    const { env } = await import("../src/config/env");
    expect(env.apiBase).toBe("");
  });

  it("上报地址与采样率靠构建期内联注入,注入值生效", async () => {
    vi.stubGlobal("window", {});
    stubEnv({ RUM_ENDPOINT: "https://rum.example.com", H5_TRACK_SAMPLE_RATE: "0.3" });
    const { env } = await import("../src/config/env");
    expect(env.rumEndpoint).toBe("https://rum.example.com");
    expect(env.trackSampleRate).toBe(0.3);
  });
});

describe("features(启用判定)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["endpoint 与 pid 齐全", { RUM_ENDPOINT: "https://rum.example.com", RUM_PID: "pid-1" }, true],
    ["只配 endpoint", { RUM_ENDPOINT: "https://rum.example.com" }, false],
    ["只配 pid", { RUM_PID: "pid-1" }, false],
    ["全缺", {}, false]
  ])("monitor %s → %s", async (_name, overrides, expected) => {
    stubEnv(overrides);
    const { features } = await import("../src/config/feature");
    expect(features.monitor).toBe(expected);
  });

  it.each([
    ["已配置", { TRACK_ENDPOINT: "https://track.example.com" }, true],
    ["未配置", {}, false],
    ["空白串", { TRACK_ENDPOINT: " " }, false]
  ])("track %s → %s", async (_name, overrides, expected) => {
    stubEnv(overrides);
    const { features } = await import("../src/config/feature");
    expect(features.track).toBe(expected);
  });

  it("采样率自 env 透传,越界截断", async () => {
    stubEnv({ H5_MONITOR_SAMPLE_RATE: "0.2", H5_TRACK_SAMPLE_RATE: "5" });
    const { features } = await import("../src/config/feature");
    expect(features.monitorSampleRate).toBe(0.2);
    expect(features.trackSampleRate).toBe(1);
  });
});
