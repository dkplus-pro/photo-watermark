// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// facade 分发与 web-vitals 载荷映射(docs/site-shell-plan.md 阶段 4.1 验收):多 sink
// 顺序分发、空 sink no-op、单个 sink 抛错不冒泡;纯逻辑用 node 环境(无 DOM 依赖)。
const h = vi.hoisted(() => ({
  onCLS: vi.fn(),
  onFCP: vi.fn(),
  onINP: vi.fn(),
  onLCP: vi.fn(),
  onTTFB: vi.fn()
}));

vi.mock("web-vitals", () => h);

import { toWebVitalsPayload, type TrackingPayload } from "../src/config/tracking-events";
import { createTrackingFacade, initTracking } from "../src/tracking";
import type { TrackingSink } from "../src/tracking/sinks";

const recordingSink = (records: Array<{ name: string; event: string; payload?: TrackingPayload }>) =>
  (name: TrackingSink["name"]): TrackingSink => ({
    name,
    send: (event, payload) => {
      records.push({ name, event, payload });
    }
  });

describe("createTrackingFacade 分发", () => {
  it("事件按注册顺序分发到全部 sink,载荷原样透传", () => {
    const records: Array<{ name: string; event: string; payload?: TrackingPayload }> = [];
    const register = recordingSink(records);
    const facade = createTrackingFacade([register("console"), register("rum"), register("http")]);
    const payload = { path: "/posts/1", referrer: "https://ref.example.com" };
    facade.track("page_view", payload);
    expect(records).toEqual([
      { name: "console", event: "page_view", payload },
      { name: "rum", event: "page_view", payload },
      { name: "http", event: "page_view", payload }
    ]);
  });

  it("payload 缺省时 sink 收到 undefined", () => {
    const send = vi.fn();
    createTrackingFacade([{ name: "console", send }]).track("web_vitals");
    expect(send).toHaveBeenCalledWith("web_vitals", undefined);
  });

  it("空 sink 组合整体 no-op(未启用场景)", () => {
    const facade = createTrackingFacade([]);
    expect(() => {
      facade.track("page_view", { path: "/" });
      facade.trackPageView({ path: "/" });
    }).not.toThrow();
  });
});

describe("createTrackingFacade 容错", () => {
  it("单个 sink 同步抛错不冒泡,其余 sink 照常收到事件", () => {
    const following = vi.fn();
    const facade = createTrackingFacade([
      {
        name: "console",
        send: () => {
          throw new Error("sink boom");
        }
      },
      { name: "http", send: following }
    ]);
    expect(() => facade.track("page_view", { path: "/" })).not.toThrow();
    expect(following).toHaveBeenCalledTimes(1);
    expect(following).toHaveBeenCalledWith("page_view", { path: "/" });
  });

  it("首个 sink 抛错不影响后续 sink 的分发顺序", () => {
    const records: Array<{ name: string; event: string; payload?: TrackingPayload }> = [];
    const register = recordingSink(records);
    const facade = createTrackingFacade([
      register("console"),
      {
        name: "rum",
        send: () => {
          throw new Error("sink boom");
        }
      },
      register("http")
    ]);
    facade.track("page_view", { path: "/" });
    expect(records.map((record) => record.name)).toEqual(["console", "http"]);
  });
});

describe("trackPageView 参数透传(node 无 document,不注入 referrer)", () => {
  it("显式 referrer 原样保留", () => {
    const send = vi.fn();
    createTrackingFacade([{ name: "console", send }]).trackPageView({
      path: "/",
      referrer: "https://ref.example.com"
    });
    expect(send).toHaveBeenCalledWith("page_view", {
      path: "/",
      referrer: "https://ref.example.com"
    });
  });

  it("未提供 referrer 时(node 环境)不下发该字段", () => {
    const send = vi.fn();
    createTrackingFacade([{ name: "console", send }]).trackPageView({ path: "/" });
    expect(send).toHaveBeenCalledWith("page_view", { path: "/" });
  });
});

describe("toWebVitalsPayload 指标→载荷映射", () => {
  it("五类字段映射,navigationType 映射为 navigation_type", () => {
    expect(
      toWebVitalsPayload({
        name: "LCP",
        value: 1234.5,
        rating: "needs-improvement",
        id: "lcp-1",
        delta: 100,
        navigationType: "reload"
      })
    ).toEqual({
      metric: "LCP",
      value: 1234.5,
      rating: "needs-improvement",
      id: "lcp-1",
      delta: 100,
      navigation_type: "reload"
    });
  });

  it("navigationType 缺省时不下发该字段", () => {
    const payload = toWebVitalsPayload({
      name: "CLS",
      value: 0.02,
      rating: "good",
      id: "cls-1",
      delta: 0.02
    });
    expect(payload).toEqual({
      metric: "CLS",
      value: 0.02,
      rating: "good",
      id: "cls-1",
      delta: 0.02
    });
    expect("navigation_type" in payload).toBe(false);
  });

  it("value 与 delta 允许不同(CLS 累计场景)", () => {
    const payload = toWebVitalsPayload({
      name: "CLS",
      value: 0.1,
      rating: "good",
      id: "cls-1",
      delta: 0.05
    });
    expect(payload.value).toBe(0.1);
    expect(payload.delta).toBe(0.05);
  });
});

describe("initTracking SSR 守卫(node,window 缺失)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("不注册 web-vitals 指标回调", () => {
    initTracking([{ name: "console", send: () => undefined }]);
    expect(h.onCLS).not.toHaveBeenCalled();
    expect(h.onFCP).not.toHaveBeenCalled();
    expect(h.onINP).not.toHaveBeenCalled();
    expect(h.onLCP).not.toHaveBeenCalled();
    expect(h.onTTFB).not.toHaveBeenCalled();
  });
});
