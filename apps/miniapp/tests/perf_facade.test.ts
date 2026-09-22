// core/perf 纯逻辑边界(方案 §5 阶段 2.3;六类边界:能力缺失/空值/越界时长/非法宿主):
// 能力检测降级、mark 入队形状、readEntries 观察器异常处理。queue/wx 全部注入。
import { describe, expect, it, vi } from "vitest";

import { createPerf, type WxPerfLike } from "../src/core/perf";
import type { ReportQueue, TransportEvent } from "../src/core/transport/queue";

function fakeQueue() {
  const events: TransportEvent[] = [];
  const enqueue = vi.fn((event: TransportEvent) => {
    events.push(event);
  });
  const queue: ReportQueue = {
    enqueue,
    flush: vi.fn(async () => undefined),
    size: () => events.length,
    dispose: () => undefined
  };
  return { events, enqueue, queue };
}

function wxWithPerf(): WxPerfLike {
  return {
    getPerformance: () => ({
      createObserver: () => ({
        observe: () => undefined,
        disconnect: () => undefined
      })
    })
  };
}

describe("createPerf(能力检测)", () => {
  it("getPerformance/createObserver 齐全 → 支持检测", () => {
    const { queue } = fakeQueue();
    expect(createPerf({ queue, wx: wxWithPerf() }).supportsPerformance()).toBe(true);
  });
  it("wx 缺失/getPerformance 缺/createObserver 缺 → 不支持(空值边界)", () => {
    const { queue } = fakeQueue();
    expect(createPerf({ queue, wx: undefined }).supportsPerformance()).toBe(false);
    expect(createPerf({ queue, wx: {} }).supportsPerformance()).toBe(false);
    expect(createPerf({ queue, wx: { getPerformance: () => ({}) } }).supportsPerformance()).toBe(false);
  });
});

describe("mark(自定义打点)", () => {
  it("入队 perf.<name>,携带 version/buildTime", () => {
    const { events, queue } = fakeQueue();
    const p = createPerf({ queue, wx: undefined, now: () => 7, version: "1.0.0", buildTime: "T" });
    p.mark("app.launch");
    p.mark("page.first_render", 321);
    expect(events[0]).toMatchObject({
      event: "perf.app.launch",
      timestamp: 7,
      level: "info",
      props: { version: "1.0.0", buildTime: "T" }
    });
    expect((events[1].props as Record<string, unknown>).duration).toBe(321);
  });
  it("observer 回调条目过滤:duration 非法值不收录(越界)", () => {
    const { queue } = fakeQueue();
    let push: (entry: { name?: string; path?: string; duration?: number }) => void = () => undefined;
    const wx: WxPerfLike = {
      getPerformance: () => ({
        createObserver: callback => {
          push = callback;
          return { observe: () => undefined, disconnect: () => undefined };
        }
      })
    };
    const p = createPerf({ queue, wx });
    expect(p.readEntries()).toEqual([]); // 首次调用创建观察器,wx 回调异步推送
    push({ name: "firstRender", path: "pages/index/index", duration: 12 });
    push({ name: "bad", path: "", duration: Number.NaN });
    expect(p.readEntries()).toEqual([{ name: "firstRender", path: "pages/index/index", duration: 12 }]);
    expect(p.readEntries()).toEqual(p.readEntries());
  });
  it("createObserver 抛错:readEntries 返回空数组不抛错", () => {
    const { queue } = fakeQueue();
    const wx: WxPerfLike = {
      getPerformance: () => ({
        createObserver: () => {
          throw new Error("boom");
        }
      })
    };
    expect(createPerf({ queue, wx }).readEntries()).toEqual([]);
  });
});
