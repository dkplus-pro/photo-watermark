// core/track 纯逻辑边界(方案 §5 阶段 2.2;六类边界:空值/零值/越界/非法状态):
// 采样判定、公共参数组装、facade 入队形状与开关/采样短路。queue 用 fake 注入。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTracker, expose, flushTrack, isSampled, pageView, track } from "../src/core/track";
import { collectCommonParams, refreshNetworkType, type WxLike } from "../src/core/track/params";
import type { ReportQueue, TransportEvent } from "../src/core/transport/queue";

function fakeQueue() {
  const events: TransportEvent[] = [];
  const enqueue = vi.fn((event: TransportEvent) => {
    events.push(event);
  });
  const flush = vi.fn(async () => undefined);
  const queue: ReportQueue = {
    enqueue,
    flush,
    size: () => events.length,
    dispose: () => undefined
  };
  return { events, enqueue, flush, queue };
}

describe("isSampled(采样判定)", () => {
  const random = vi.fn(() => 0.4);
  it("rate=1 全采,random 不被调用", () => {
    expect(isSampled(1, random)).toBe(true);
    expect(random).not.toHaveBeenCalled();
  });
  it("rate=0 全丢", () => {
    expect(isSampled(0, random)).toBe(false);
  });
  it("rate=0.5 按随机源判定", () => {
    expect(isSampled(0.5, () => 0.2)).toBe(true);
    expect(isSampled(0.5, () => 0.7)).toBe(false);
  });
  it("越界/非法回退全采(负数/大于 1/NaN/undefined)", () => {
    for (const rate of [-1, 1.5, Number.NaN, undefined]) {
      expect(isSampled(rate, () => 0.9)).toBe(true);
    }
  });
});

describe("collectCommonParams(公共参数)", () => {
  // 网络类型是模块级缓存,用例间显式复位避免串扰
  beforeEach(() => {
    refreshNetworkType(undefined, "unknown");
  });

  it("wx 能力齐全:设备/系统取值,network 走缓存注入", () => {
    const wx: WxLike = {
      getSystemInfoSync: () => ({ model: "iPhone 15", system: "iOS 18" }),
      getNetworkType: () => undefined
    };
    refreshNetworkType(wx, "wifi");
    const params = collectCommonParams({ wx, version: "1.2.3", buildTime: "T" });
    expect(params).toEqual({
      version: "1.2.3",
      buildTime: "T",
      uid: null,
      device: "iPhone 15",
      system: "iOS 18",
      network: "wifi"
    });
  });
  it("无 wx/接口缺失:降级 unknown 不抛错", () => {
    const params = collectCommonParams({ wx: undefined, version: "1", buildTime: "" });
    expect(params.device).toBe("unknown");
    expect(params.system).toBe("unknown");
    expect(params.network).toBe("unknown");
  });
  it("getSystemInfoSync 抛错:字段回退 unknown,异常不外溢", () => {
    const wx: WxLike = {
      getSystemInfoSync: () => {
        throw new Error("boom");
      }
    };
    const params = collectCommonParams({ wx, version: "1", buildTime: "" });
    expect(params.device).toBe("unknown");
    expect(params.system).toBe("unknown");
  });
  it("uid 恒为 null(C 端用户体系落地前的配置坑)", () => {
    expect(collectCommonParams({ wx: undefined }).uid).toBeNull();
  });
});

describe("createTracker(facade 入队)", () => {
  const base = {
    commonParams: () => ({
      version: "1.0.0",
      buildTime: "T",
      uid: null,
      device: "dev",
      system: "sys",
      network: "wifi"
    }),
    now: () => 1234
  };

  it("track:custom 事件入队,公共参数在 props 中,payload 透传", () => {
    const { enqueue, events, queue } = fakeQueue();
    const t = createTracker({ ...base, queue });
    t.track("order.submit", { amount: 9 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(events[0].event).toBe("track.custom");
    expect(events[0].timestamp).toBe(1234);
    expect(events[0].props).toMatchObject({
      name: "order.submit",
      amount: 9,
      version: "1.0.0",
      uid: null,
      device: "dev"
    });
  });

  it("click 事件归类 track.click;page_view 带 path", () => {
    const { events, queue } = fakeQueue();
    const t = createTracker({ ...base, queue });
    t.track("click", { target: "btn" });
    t.pageView("pages/index/index");
    expect(events.map((e) => e.event)).toEqual(["track.click", "track.page_view"]);
    expect(events[1].props).toMatchObject({ name: "page_view", path: "pages/index/index" });
  });

  it("总开关关闭:零入队(非法状态迁移)", () => {
    const { enqueue, queue } = fakeQueue();
    const t = createTracker({ ...base, queue, enabled: false });
    t.track("x");
    t.pageView("p");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("采样短路:rate=0 零入队;rate=1 全入队", () => {
    const zero = fakeQueue();
    createTracker({ ...base, queue: zero.queue, sampleRate: 0 }).track("a");
    expect(zero.enqueue).not.toHaveBeenCalled();

    const full = fakeQueue();
    createTracker({ ...base, queue: full.queue, sampleRate: 1 }).track("b");
    expect(full.enqueue).toHaveBeenCalledTimes(1);
  });

  it("flush 透传队列", async () => {
    const { flush, queue } = fakeQueue();
    await createTracker({ ...base, queue }).flush();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe("业务单例 facade(模块级 track/pageView/expose/flushTrack)", () => {
  // 单例走真实 transport 组装(endpoint 为空 → HTTP sink 禁用,写通道降级 console),
  // 本组只验证模块级入口到落盘链路健康;console 输出打桩静默并借桩断言事件形状。
  let consoleStubs: Array<ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    consoleStubs = (["info", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function loggedTrackEvents(): TransportEvent[] {
    return consoleStubs
      .flatMap((stub) => stub.mock.calls)
      .filter(
        (args) =>
          typeof args[0] === "string" && (args[0] as string).startsWith("[transport] track.")
      )
      .map((args) => args[1] as TransportEvent);
  }

  it("模块级 track/pageView/expose 经单例真实队列落盘(含 expose 新入口)", async () => {
    track("order.submit", { amount: 9 });
    pageView("pages/index/index");
    expose("home.banner");
    await expect(flushTrack()).resolves.toBeUndefined();

    const events = loggedTrackEvents();
    expect(events.map((event) => event.event)).toEqual([
      "track.custom",
      "track.page_view",
      "track.expose"
    ]);
    expect(events[2].props).toMatchObject({ name: "expose", trackId: "home.banner" });
  });

  it("单例公共参数走缺省组装(真实 collectCommonParams,版本号有兜底)", async () => {
    track("smoke.only");
    await flushTrack();

    const events = loggedTrackEvents();
    expect(events).toHaveLength(1);
    expect(events[0].props).toMatchObject({ name: "smoke.only", version: expect.any(String) });
    expect(events[0].props.uid).toBeNull();
  });
});
