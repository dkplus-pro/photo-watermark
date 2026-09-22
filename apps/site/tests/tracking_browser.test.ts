// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 三 sink 的浏览器行为与默认装配(jsdom,window 存在):sendBeacon 优先/降级 fetch、
// RUM 自定义事件广播、trackPageView 的 document.referrer 兜底、默认 sink 组合门控、
// web-vitals 指标注册与载荷分发。
const rum = vi.hoisted(() => ({ sendEvent: vi.fn() }));

vi.mock("@arms/rum-browser", () => rum);

const vitals = vi.hoisted(() => ({
  onCLS: vi.fn(),
  onFCP: vi.fn(),
  onINP: vi.fn(),
  onLCP: vi.fn(),
  onTTFB: vi.fn()
}));

vi.mock("web-vitals", () => vitals);

import type { SiteEnv } from "../src/config/env";
import type { WebVitalsMetricInput } from "../src/config/tracking-events";
import {
  createDefaultSinks,
  createTrackingFacade,
  initTracking,
  track,
  trackPageView
} from "../src/tracking";
import { createHttpSink, createRumSink } from "../src/tracking/sinks";

const flushAsync = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const baseEnv = (overrides: Partial<SiteEnv>): SiteEnv => ({
  siteApiBase: "http://127.0.0.1:8080",
  rumEndpoint: "",
  rumPid: "",
  trackEndpoint: "",
  ...overrides
});

describe("createHttpSink 浏览器行为", () => {
  let beacon: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  const setSendBeacon = (impl: unknown): void => {
    Object.defineProperty(window.navigator, "sendBeacon", { value: impl, configurable: true });
  };

  beforeEach(() => {
    beacon = vi.fn(() => true);
    fetchMock = vi.fn(() => Promise.resolve());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete (window.navigator as unknown as { sendBeacon?: unknown }).sendBeacon;
    vi.unstubAllGlobals();
  });

  it("sendBeacon 可用且返回 true 时优先使用,不走 fetch", () => {
    setSendBeacon(beacon);
    createHttpSink("https://track.example.com").send("page_view", { path: "/" });
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0] as [string, Blob];
    expect(url).toBe("https://track.example.com");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/json");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sendBeacon 返回 false 时降级 fetch keepalive", () => {
    setSendBeacon(vi.fn(() => false));
    createHttpSink("https://track.example.com").send("page_view", { path: "/p" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://track.example.com");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({
      event: "page_view",
      payload: { path: "/p" },
      timestamp: expect.any(Number)
    });
  });

  it("sendBeacon 不可用时降级 fetch", () => {
    setSendBeacon(undefined);
    createHttpSink("https://track.example.com").send("page_view", { path: "/" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("payload 缺省时上报体 payload 兜底为空对象", () => {
    setSendBeacon(vi.fn(() => false));
    createHttpSink("https://track.example.com").send("web_vitals");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      event: "web_vitals",
      payload: {},
      timestamp: expect.any(Number)
    });
  });

  it("fetch 拒绝时静默,不冒泡", async () => {
    setSendBeacon(undefined);
    fetchMock.mockReturnValue(Promise.reject(new Error("network down")));
    expect(() =>
      createHttpSink("https://track.example.com").send("page_view", { path: "/" })
    ).not.toThrow();
    await flushAsync();
  });
});

describe("createRumSink 浏览器行为", () => {
  beforeEach(() => {
    rum.sendEvent.mockClear();
    vi.stubEnv("RUM_ENDPOINT", "https://rum.example.com");
    vi.stubEnv("RUM_PID", "pid-1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("发送时转成 ARMS 自定义事件(无 value 载荷按 1 计数)", async () => {
    createRumSink()?.send("page_view", { path: "/" });
    await vi.waitFor(() => expect(rum.sendEvent).toHaveBeenCalledTimes(1));
    expect(rum.sendEvent).toHaveBeenCalledWith({
      event_type: "custom",
      type: "custom",
      name: "page_view",
      value: 1,
      properties: { path: "/" }
    });
  });

  it("web_vitals 载荷自带数值 value 时透传为聚合维度", async () => {
    createRumSink()?.send("web_vitals", {
      metric: "LCP",
      value: 1234.5,
      rating: "good",
      id: "lcp-1",
      delta: 1234.5
    });
    await vi.waitFor(() => expect(rum.sendEvent).toHaveBeenCalledTimes(1));
    expect(rum.sendEvent.mock.calls[0][0]).toMatchObject({ name: "web_vitals", value: 1234.5 });
  });

  it("SDK 广播抛错不冒泡", async () => {
    rum.sendEvent.mockImplementation(() => {
      throw new Error("rum boom");
    });
    expect(() => createRumSink()?.send("page_view", { path: "/" })).not.toThrow();
    await vi.waitFor(() => expect(rum.sendEvent).toHaveBeenCalledTimes(1));
  });
});

describe("trackPageView document.referrer 兜底", () => {
  const collect = (): Array<{ event: string; payload: unknown }> => {
    const events: Array<{ event: string; payload: unknown }> = [];
    const facade = createTrackingFacade([
      {
        name: "console",
        send: (event, payload) => {
          events.push({ event, payload });
        }
      }
    ]);
    facade.trackPageView({ path: "/" });
    return events;
  };

  it("document.referrer 非空时注入 referrer 字段", () => {
    Object.defineProperty(document, "referrer", {
      value: "https://ref.example.com",
      configurable: true
    });
    try {
      expect(collect()).toEqual([
        { event: "page_view", payload: { path: "/", referrer: "https://ref.example.com" } }
      ]);
    } finally {
      delete (document as unknown as { referrer?: string }).referrer;
    }
  });

  it("document.referrer 为空串(无来源)时不下发 referrer", () => {
    expect(collect()).toEqual([{ event: "page_view", payload: { path: "/" } }]);
  });

  it("显式 referrer 优先于 document.referrer 兜底", () => {
    Object.defineProperty(document, "referrer", {
      value: "https://ref.example.com",
      configurable: true
    });
    try {
      const events: Array<{ event: string; payload: unknown }> = [];
      const facade = createTrackingFacade([
        {
          name: "console",
          send: (event, payload) => {
            events.push({ event, payload });
          }
        }
      ]);
      facade.trackPageView({ path: "/", referrer: "https://explicit.example.com" });
      expect(events).toEqual([
        { event: "page_view", payload: { path: "/", referrer: "https://explicit.example.com" } }
      ]);
    } finally {
      delete (document as unknown as { referrer?: string }).referrer;
    }
  });
});

describe("createDefaultSinks 默认 sink 组合", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("tracking 关(TRACK_ENDPOINT 缺失强制关)返回空组合,整体 no-op", () => {
    expect(createDefaultSinks(baseEnv({}))).toEqual([]);
  });

  it("tracking 开启时 dev 下注册 console + http", () => {
    const sinks = createDefaultSinks(baseEnv({ trackEndpoint: "https://track.example.com" }));
    expect(sinks.map((sink) => sink.name)).toEqual(["console", "http"]);
  });

  it("RUM 配置齐全时并入 rum sink", () => {
    vi.stubEnv("RUM_ENDPOINT", "https://rum.example.com");
    vi.stubEnv("RUM_PID", "pid-1");
    const sinks = createDefaultSinks(baseEnv({ trackEndpoint: "https://track.example.com" }));
    expect(sinks.map((sink) => sink.name)).toEqual(["console", "rum", "http"]);
  });

  it("RUM 配置缺失不注册 rum sink", () => {
    const sinks = createDefaultSinks(baseEnv({ trackEndpoint: "https://track.example.com" }));
    expect(sinks.map((sink) => sink.name)).toEqual(["console", "http"]);
  });

  it("production 不注册 console sink", () => {
    vi.stubEnv("NODE_ENV", "production");
    const sinks = createDefaultSinks(baseEnv({ trackEndpoint: "https://track.example.com" }));
    expect(sinks.map((sink) => sink.name)).toEqual(["http"]);
  });
});

describe("initTracking web-vitals 接入", () => {
  beforeEach(() => {
    for (const report of Object.values(vitals)) {
      report.mockClear();
    }
  });

  it("client 侧注册 CLS/LCP/INP/FCP/TTFB 五类指标回调", async () => {
    initTracking([{ name: "console", send: () => undefined }]);
    await vi.waitFor(() => expect(vitals.onCLS).toHaveBeenCalledTimes(1));
    expect(vitals.onFCP).toHaveBeenCalledTimes(1);
    expect(vitals.onINP).toHaveBeenCalledTimes(1);
    expect(vitals.onLCP).toHaveBeenCalledTimes(1);
    expect(vitals.onTTFB).toHaveBeenCalledTimes(1);
  });

  it("指标回调触发时经 facade 分发 web_vitals 载荷", async () => {
    const send = vi.fn();
    initTracking([{ name: "console", send }]);
    await vi.waitFor(() => expect(vitals.onCLS).toHaveBeenCalledTimes(1));
    const report = vitals.onCLS.mock.calls[0][0] as (metric: WebVitalsMetricInput) => void;
    report({
      name: "CLS",
      value: 0.05,
      rating: "good",
      id: "cls-1",
      delta: 0.05,
      navigationType: "reload"
    });
    expect(send).toHaveBeenCalledWith("web_vitals", {
      metric: "CLS",
      value: 0.05,
      rating: "good",
      id: "cls-1",
      delta: 0.05,
      navigation_type: "reload"
    });
  });

  it("sink 组合为空(未启用)时不注册任何指标回调", async () => {
    initTracking([]);
    await flushAsync();
    expect(vitals.onCLS).not.toHaveBeenCalled();
    expect(vitals.onTTFB).not.toHaveBeenCalled();
  });
});

describe("默认实例门控(jsdom 客户端,TRACK_ENDPOINT 未配置)", () => {
  it("track/trackPageView 整体 no-op,不触发 console 观测", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      expect(() => {
        track("page_view", { path: "/" });
        trackPageView({ path: "/" });
      }).not.toThrow();
      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
    }
  });
});
