import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteEnv } from "../../src/config/env";
import { readFeatureFlags } from "../../src/config/features";

// 特性开关(src/config/features.ts):rum 在 RUM_ENDPOINT/RUM_PID 任一缺失时强制 false;
// tracking 未配置 no-op;retry 默认开启。
const baseEnv = (overrides: Partial<SiteEnv>): SiteEnv => ({
  siteApiBase: "http://127.0.0.1:8080",
  rumEndpoint: "",
  rumPid: "",
  trackEndpoint: "",
  ...overrides
});

describe("readFeatureFlags", () => {
  it("RUM_ENDPOINT/RUM_PID 齐全时 rum 开启", () => {
    expect(
      readFeatureFlags(baseEnv({ rumEndpoint: "https://rum.example.com", rumPid: "pid-1" })).rum
    ).toBe(true);
  });

  it.each([
    ["缺 endpoint", { rumEndpoint: "" }],
    ["缺 pid", { rumPid: "" }],
    ["全缺", {}]
  ])("rum %s 时强制 false", (_name, overrides) => {
    expect(readFeatureFlags(baseEnv(overrides)).rum).toBe(false);
  });

  it("TRACK_ENDPOINT 未配置时 tracking 关闭,配置后开启", () => {
    expect(readFeatureFlags(baseEnv({})).tracking).toBe(false);
    expect(readFeatureFlags(baseEnv({ trackEndpoint: "https://track.example.com" })).tracking).toBe(
      true
    );
  });

  it("retry 默认开启(无 env 槽位,由 client.ts 接入时消费)", () => {
    expect(readFeatureFlags(baseEnv({})).retry).toBe(true);
  });
});

describe("readFeatureFlags 默认走启动校验后的 siteEnv", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("env 只有 endpoint 缺 pid 时 rum 强制 false(对齐真实单例链路)", async () => {
    vi.stubEnv("RUM_ENDPOINT", "https://rum.example.com");
    const { readFeatureFlags: read } = await import("../../src/config/features");
    expect(read().rum).toBe(false);
  });
});
