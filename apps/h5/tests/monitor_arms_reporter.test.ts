// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createArmsReporter, isSampled } from "../src/core/monitor/arms";

// createArmsReporter 纯逻辑边界(node 环境):env 缺失降级、SSR 分支不初始化、采样判定。
// SDK 加载/转发路径(需 window)见 monitor_arms_client.test.ts(jsdom)。

const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const LOADED_PAYLOAD = { kind: "js_error", message: "boom" };

describe("createArmsReporter(降级守卫)", () => {
  it("endpoint 缺失:loader 不触发、不抛错(noop 语义)", async () => {
    const loader = vi.fn(async () => null);
    const reporter = createArmsReporter({ endpoint: "", pid: "pid-1", loadSdk: loader });
    expect(() => reporter.captureError(LOADED_PAYLOAD)).not.toThrow();
    await flush();
    expect(loader).not.toHaveBeenCalled();
  });

  it("pid 缺失:loader 不触发", async () => {
    const loader = vi.fn(async () => null);
    const reporter = createArmsReporter({ endpoint: "https://rum.example.com", pid: "", loadSdk: loader });
    reporter.captureMessage({ kind: "info", message: "hello" });
    await flush();
    expect(loader).not.toHaveBeenCalled();
  });

  it("endpoint/pid 双缺(空值边界):loader 不触发", async () => {
    const loader = vi.fn(async () => null);
    const reporter = createArmsReporter({ endpoint: "", pid: "", loadSdk: loader });
    reporter.captureError(LOADED_PAYLOAD);
    await flush();
    expect(loader).not.toHaveBeenCalled();
  });

  it("SSR 分支(node 环境,typeof window === undefined):配置齐全也不初始化", async () => {
    const loader = vi.fn(async () => null);
    const reporter = createArmsReporter({
      endpoint: "https://rum.example.com",
      pid: "pid-1",
      loadSdk: loader
    });
    expect(() => reporter.captureError(LOADED_PAYLOAD)).not.toThrow();
    await flush();
    expect(loader).not.toHaveBeenCalled();
  });

  it("采样率 0:零网络行为(loader 不触发)", async () => {
    const loader = vi.fn(async () => null);
    const reporter = createArmsReporter({
      endpoint: "https://rum.example.com",
      pid: "pid-1",
      sampleRate: 0,
      loadSdk: loader
    });
    reporter.captureError(LOADED_PAYLOAD);
    await flush();
    expect(loader).not.toHaveBeenCalled();
  });
});

describe("isSampled(采样判定)", () => {
  it.each([
    ["全采(rate=1)", 1, 0.99, true],
    ["上越界全采(rate>1)", 1.5, 0.99, true],
    ["全丢(rate=0)", 0, 0.01, false],
    ["下越界全丢(rate<0)", -0.5, 0.01, false],
    ["半采命中(random<rate)", 0.5, 0.49, true],
    ["半采未命中(random=rate 边界,严格小于)", 0.5, 0.5, false]
  ])("%s", (_name, rate, randomValue, expected) => {
    expect(isSampled(rate, () => randomValue)).toBe(expected);
  });
});
