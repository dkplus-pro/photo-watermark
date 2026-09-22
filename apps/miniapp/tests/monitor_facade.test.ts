// core/monitor 纯逻辑边界(方案 §5 阶段 2.1;六类边界:空值/非法 JSON/非法状态/越界采样):
// 规范化四类(js/api/unhandled_rejection/page_not_found)、采样判定、facade 入队与开关。
// queue 用 fake 注入,不触真实 sink。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureError,
  captureMessage,
  createMonitor,
  flushMonitor,
  isMonitorSampled,
  monitor
} from "../src/core/monitor";
import {
  normalizeApiError,
  normalizeJsError,
  normalizePageNotFound,
  normalizeUnhandledRejection
} from "../src/core/monitor/normalize";
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

describe("isMonitorSampled(采样判定)", () => {
  it("rate=1 全采;rate=0 全丢;0.5 按随机源", () => {
    expect(isMonitorSampled(1)).toBe(true);
    expect(isMonitorSampled(0)).toBe(false);
    expect(isMonitorSampled(0.5, () => 0.2)).toBe(true);
    expect(isMonitorSampled(0.5, () => 0.8)).toBe(false);
  });
  it("越界/非法回退全采(负数/NaN/大于 1/undefined)", () => {
    for (const rate of [-1, Number.NaN, 1.2, undefined]) {
      expect(isMonitorSampled(rate, () => 0.9)).toBe(true);
    }
  });
});

describe("normalize*(规范化四类)", () => {
  it("js_error:字符串拆 head/stack;空值回退占位", () => {
    expect(normalizeJsError("TypeError: boom\n  at f()").message).toBe("TypeError: boom");
    expect(normalizeJsError("TypeError: boom\n  at f()").stack).toContain("at f()");
    expect(normalizeJsError("").message).toBe("[unknown js error]");
    expect(normalizeJsError(undefined).message).toBe("[unknown js error]");
  });
  it("unhandled_rejection:Error/字符串/null/循环引用分别归一", () => {
    expect(normalizeUnhandledRejection({ reason: new Error("boom") }).message).toBe("Error: boom");
    expect(normalizeUnhandledRejection({ reason: "plain" }).message).toBe("plain");
    expect(normalizeUnhandledRejection({ reason: null }).message).toBe("[unhandled rejection]");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => normalizeUnhandledRejection({ reason: circular })).not.toThrow();
    expect(normalizeUnhandledRejection({ reason: circular }).message).toBe(
      "[unserializable rejection reason]"
    );
  });
  it("page_not_found:path 缺失回退占位,query 透传", () => {
    expect(normalizePageNotFound({ path: "pages/x/index", query: { a: "1" } }).message).toContain(
      "pages/x/index"
    );
    expect(normalizePageNotFound(undefined).message).toBe("页面不存在: [unknown path]");
  });
  it("api_error:endpoint/errMsg 缺失回退,code 零值安全", () => {
    const payload = normalizeApiError({});
    expect(payload.message).toContain("[unknown endpoint]");
    expect(normalizeApiError({ endpoint: "/ping", errMsg: "timeout", code: 0 }).extra).toEqual({
      endpoint: "/ping",
      code: 0
    });
  });
});

describe("createMonitor(facade 入队)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("captureError:事件名/等级/时间戳按规范入队", () => {
    const { enqueue, events, queue } = fakeQueue();
    const m = createMonitor({ queue, now: () => 42 });
    m.captureError({ kind: "api_error", message: "boom", stack: "s", extra: { code: 500 } });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(events[0].event).toBe("monitor.api_error");
    expect(events[0].level).toBe("error");
    expect(events[0].timestamp).toBe(42);
    expect(events[0].props).toMatchObject({ kind: "api_error", message: "boom", stack: "s" });
  });

  it("page_not_found 等级为 warn;captureMessage 走 captureMessage 通道", () => {
    const { events, queue } = fakeQueue();
    const m = createMonitor({ queue });
    m.captureMessage("page_not_found", "页面不存在: x");
    expect(events[0].level).toBe("warn");
    expect(events[0].event).toBe("monitor.page_not_found");
  });

  it("总开关关闭:零入队(非法状态迁移)", () => {
    const { enqueue, queue } = fakeQueue();
    const m = createMonitor({ queue, enabled: false });
    m.captureError({ kind: "js_error", message: "x" });
    m.captureMessage("api_error", "y");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("采样短路:rate=0 零入队;rate=1 全入队", () => {
    const zero = fakeQueue();
    createMonitor({ queue: zero.queue, sampleRate: 0 }).captureError({
      kind: "js_error",
      message: "x"
    });
    expect(zero.enqueue).not.toHaveBeenCalled();

    const full = fakeQueue();
    createMonitor({ queue: full.queue, sampleRate: 1 }).captureError({
      kind: "js_error",
      message: "x"
    });
    expect(full.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("业务单例", () => {
  it("captureError 透传单例(不抛错即视为降级链路健康;真实入队在集成层)", () => {
    expect(() => captureError({ kind: "js_error", message: "smoke" })).not.toThrow();
    expect(monitor).toHaveProperty("captureError");
  });
});

describe("业务单例 facade(captureMessage/flushMonitor/createMonitor.flush)", () => {
  // 单例走真实 transport 组装(endpoint 为空 → HTTP sink 禁用,写通道降级 console),
  // console 输出打桩静默并借桩断言事件形状。
  let consoleStubs: Array<ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    consoleStubs = (["info", "warn", "error"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captureMessage 经单例真实队列落盘,flushMonitor 透传 flush", async () => {
    captureMessage("js_error", "单例链路 smoke");
    await expect(flushMonitor()).resolves.toBeUndefined();

    const logged = consoleStubs
      .flatMap((stub) => stub.mock.calls)
      .filter(
        (args) =>
          typeof args[0] === "string" && (args[0] as string).startsWith("[transport] monitor.")
      )
      .map((args) => args[1] as TransportEvent);
    expect(logged.map((event) => event.event)).toContain("monitor.js_error");
  });

  it("createMonitor flush 透传队列", async () => {
    const { flush, queue } = fakeQueue();
    await createMonitor({ queue }).flush();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
