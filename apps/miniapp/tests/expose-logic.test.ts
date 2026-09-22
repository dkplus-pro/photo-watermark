// 曝光判定与去重纯逻辑边界(方案 docs/hybrid-capability-plan.md 卡 5.3;
// 六类边界:空值/零值/越界/权限缺失(开关等价)/非法状态迁移)。
// 纯 node 测试:定时器全部注入 fake,不依赖真实时间流逝。
import { describe, expect, it, vi } from "vitest";

import {
  createExposeDedup,
  createExposeSession,
  shouldExpose
} from "../src/core/track/expose-logic";
import { createTracker } from "../src/core/track";
import type { ReportQueue, TransportEvent } from "../src/core/transport/queue";

/** fake 定时器 harness:注册不自动触发,fire() 手动触发最近一个 handler。 */
function createFakeTimers() {
  let seq = 0;
  const pending = new Map<number, { handler: () => void; ms: number }>();
  const cleared: unknown[] = [];
  const registeredMs: number[] = [];
  return {
    setTimeoutFn: (handler: () => void, ms: number) => {
      const handle = (seq += 1);
      pending.set(handle, { handler, ms });
      registeredMs.push(ms);
      return handle;
    },
    clearTimeoutFn: (handle: unknown) => {
      cleared.push(handle);
      pending.delete(handle as number);
    },
    fire: () => {
      const entries = [...pending.entries()];
      if (entries.length === 0) return;
      const [handle, entry] = entries[entries.length - 1];
      pending.delete(handle);
      entry.handler();
    },
    cleared,
    registeredMs
  };
}

describe("shouldExpose(双阈值判定)", () => {
  it("EX1 比例与时长阈值边界", () => {
    expect(shouldExpose(0.499, 300)).toBe(false);
    expect(shouldExpose(0.5, 300)).toBe(true);
    expect(shouldExpose(1, 300)).toBe(true);
    expect(shouldExpose(0.5, 299)).toBe(false);
    expect(shouldExpose(0.5, 301)).toBe(true);
  });

  it("EX2 非法入参一律 false(空值/越界)", () => {
    for (const ratio of [Number.NaN, -1, Number.POSITIVE_INFINITY, -0.1]) {
      expect(shouldExpose(ratio, 300)).toBe(false);
    }
    for (const durationMs of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(shouldExpose(1, durationMs)).toBe(false);
    }
  });
});

describe("createExposeDedup(实例级去重)", () => {
  it("EX3 首次放行,重复拒绝,reset 后可再放行(非法状态迁移)", () => {
    const dedup = createExposeDedup();
    expect(dedup.size()).toBe(0);
    expect(dedup.tryMark("home.banner")).toBe(true);
    expect(dedup.tryMark("home.banner")).toBe(false);
    expect(dedup.has("home.banner")).toBe(true);
    expect(dedup.size()).toBe(1);
    dedup.reset();
    expect(dedup.has("home.banner")).toBe(false);
    expect(dedup.size()).toBe(0);
    expect(dedup.tryMark("home.banner")).toBe(true);
  });
});

describe("createExposeSession(曝光会话)", () => {
  it("EX4 达标:注册阈值时长定时器,触发后上报一次 trackId", () => {
    const timers = createFakeTimers();
    const report = vi.fn();
    const session = createExposeSession({
      trackId: "home.banner",
      report,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn
    });

    session.onVisible(0.5);
    expect(timers.registeredMs).toEqual([300]);
    expect(report).not.toHaveBeenCalled();

    timers.fire();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("home.banner");
  });

  it("EX5 比例不足:不起表不上报(越界)", () => {
    const timers = createFakeTimers();
    const report = vi.fn();
    createExposeSession({
      trackId: "home.banner",
      report,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn
    }).onVisible(0.49);

    expect(timers.registeredMs).toEqual([]);
    timers.fire();
    expect(report).not.toHaveBeenCalled();
  });

  it("EX6 持续判定:比例跌回撤表,fire 不上报(非法状态迁移)", () => {
    const timers = createFakeTimers();
    const report = vi.fn();
    const session = createExposeSession({
      trackId: "home.banner",
      report,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn
    });

    session.onVisible(0.6);
    session.onVisible(0.2);
    expect(timers.cleared).toHaveLength(1);
    timers.fire();
    expect(report).not.toHaveBeenCalled();
    expect(timers.registeredMs).toHaveLength(1);
  });

  it("EX7 pending 中重复达标不重复起表(非法状态迁移)", () => {
    const timers = createFakeTimers();
    const session = createExposeSession({
      trackId: "home.banner",
      report: vi.fn(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn
    });

    session.onVisible(0.6);
    session.onVisible(0.6);
    expect(timers.registeredMs).toHaveLength(1);
  });

  it("EX8 同 session 只报一次(非法状态迁移)", () => {
    const timers = createFakeTimers();
    const report = vi.fn();
    const session = createExposeSession({
      trackId: "home.banner",
      report,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn
    });

    session.onVisible(0.6);
    timers.fire();
    session.onVisible(0.9);
    timers.fire();
    expect(report).toHaveBeenCalledTimes(1);
    expect(timers.registeredMs).toHaveLength(1);
  });

  it("EX9 跨 session 各自可报(页面重进语义)", () => {
    const report = vi.fn();
    for (let index = 0; index < 2; index += 1) {
      const timers = createFakeTimers();
      const session = createExposeSession({
        trackId: "home.banner",
        report,
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn
      });
      session.onVisible(1);
      timers.fire();
    }
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("EX10 dispose 幂等且静默(非法状态迁移)", () => {
    const timers = createFakeTimers();
    const report = vi.fn();
    const session = createExposeSession({
      trackId: "home.banner",
      report,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn
    });

    session.onVisible(0.6);
    session.dispose();
    timers.fire();
    session.onVisible(0.9);
    session.dispose();
    expect(report).not.toHaveBeenCalled();
    expect(timers.registeredMs).toHaveLength(1);
  });

  it("EX11 非法比例按 0 处理(空值)", () => {
    const timers = createFakeTimers();
    const session = createExposeSession({
      trackId: "home.banner",
      report: vi.fn(),
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn
    });

    session.onVisible(Number.NaN);
    session.onVisible(-1);
    expect(timers.registeredMs).toEqual([]);
  });

  it("EX13 缺省定时器实现:真实 setTimeout 达标上报(注入 durationMs 加速)", async () => {
    const report = vi.fn();
    const session = createExposeSession({ trackId: "home.banner", report, durationMs: 1 });

    session.onVisible(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(report).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it("EX14 缺省 clearTimeout 实现:跌回阈值撤表不再上报(空值路径覆盖)", async () => {
    const report = vi.fn();
    const session = createExposeSession({ trackId: "home.banner", report, durationMs: 1 });

    session.onVisible(1);
    session.onVisible(0); // 撤表:走缺省 clearTimeoutFn
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(report).not.toHaveBeenCalled();
    session.dispose();
  });
});

describe("track facade expose(元素曝光入队)", () => {
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

  it("EX12 expose 入队 track.expose,props 含 name/trackId/payload;空 trackId 与总开关关闭零入队", () => {
    const { events, enqueue, queue } = fakeQueue();
    const tracker = createTracker({ ...base, queue });
    tracker.expose("home.banner", { a: 1 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(events[0].event).toBe("track.expose");
    expect(events[0].props).toMatchObject({
      name: "expose",
      trackId: "home.banner",
      a: 1,
      version: "1.0.0"
    });

    tracker.expose("");
    tracker.expose("   ");
    expect(enqueue).toHaveBeenCalledTimes(1);

    const off = fakeQueue();
    createTracker({ ...base, queue: off.queue, enabled: false }).expose("home.banner");
    expect(off.enqueue).not.toHaveBeenCalled();
  });
});
