import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReportQueue,
  DEFAULT_BATCH_SIZE,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_MAX_QUEUE_SIZE,
  type DroppedBatchInfo,
  type ReportQueue
} from "../src/core/transport/queue";
import {
  createTransportRuntime,
  type Sink,
  type TransportEvent,
  type TransportRuntime
} from "../src/core/transport/sink";

// 事件身份用 timestamp 承载(TransportEvent 的已知字段只有 event/timestamp/level),
// 断言批次内容时直接比对 timestamp 序列即可。
function createEvent(index: number): TransportEvent {
  return { event: "track.custom", timestamp: index };
}

function createRecordingSink(batches: number[][]): Sink {
  return {
    name: "memory",
    write: async (events) => {
      batches.push(events.map((event) => event.timestamp));
    }
  };
}

interface QueueHarness {
  runtime: TransportRuntime;
  /** 注册过的周期定时器 */
  intervals: Array<{ handler: () => void; intervalMs: number }>;
  /** 触发最近一次注册的周期定时器回调 */
  tick(): void;
  /** 触发 app hide 回调(未注册时无操作) */
  hideApp(): void;
  /** 当前 hide 回调(未注册为 undefined) */
  hideHandler(): (() => void) | undefined;
  /** 解绑 hide 监听的次数 */
  hideUnboundTimes(): number;
  /** clearInterval 收到的句柄 */
  clearedHandles: unknown[];
  /** 运行时 console.warn 收到的调用 */
  warnings: unknown[][];
}

// 假运行时:定时器与生命周期监听全部落袋,让队列分支可被同步驱动,不依赖真实小程序环境。
function createHarness(): QueueHarness {
  const intervals: Array<{ handler: () => void; intervalMs: number }> = [];
  const clearedHandles: unknown[] = [];
  const warnings: unknown[][] = [];
  let hideHandler: (() => void) | undefined;
  let hideUnboundTimes = 0;

  const runtime = createTransportRuntime({
    getTaro: () => undefined,
    getWx: () => undefined,
    getConsole: () => ({
      warn: (...args: unknown[]) => {
        warnings.push(args);
      }
    }),
    setInterval: (handler, intervalMs) => {
      intervals.push({ handler, intervalMs });
      return intervals.length;
    },
    clearInterval: (handle) => {
      clearedHandles.push(handle);
    },
    onAppHide: (handler) => {
      hideHandler = handler;
      return () => {
        hideUnboundTimes += 1;
      };
    }
  });

  return {
    runtime,
    intervals,
    clearedHandles,
    warnings,
    tick: () => intervals[intervals.length - 1]?.handler(),
    hideApp: () => hideHandler?.(),
    hideHandler: () => hideHandler,
    hideUnboundTimes: () => hideUnboundTimes
  };
}

function enqueueRange(queue: ReportQueue, count: number, offset = 0): void {
  for (let index = 0; index < count; index += 1) queue.enqueue(createEvent(offset + index));
}

// 手动 flush() 的语义是"立刻把缓冲全部发出",会掩盖自动触发路径;
// 观察阈值/定时/生命周期触发的 flush 时用本函数让在飞链路落定。
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("createReportQueue 批量阈值 flush", () => {
  it("攒满 batchSize 立即 flush,未攒满不发送", async () => {
    const harness = createHarness();
    const batches: number[][] = [];
    const queue = createReportQueue({
      sinks: [createRecordingSink(batches)],
      runtime: harness.runtime
    });

    enqueueRange(queue, DEFAULT_BATCH_SIZE - 1);
    await settle();
    expect(batches).toHaveLength(0);
    expect(queue.size()).toBe(DEFAULT_BATCH_SIZE - 1);

    queue.enqueue(createEvent(DEFAULT_BATCH_SIZE - 1));
    await settle();
    expect(batches).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    expect(queue.size()).toBe(0);
    queue.dispose();
  });

  it("batchSize 为 1(边界值)时每条事件立即 flush", async () => {
    const harness = createHarness();
    const batches: number[][] = [];
    const queue = createReportQueue({
      sinks: [createRecordingSink(batches)],
      runtime: harness.runtime,
      batchSize: 1
    });

    queue.enqueue(createEvent(1));
    await settle();
    queue.enqueue(createEvent(2));
    await settle();
    expect(batches).toEqual([[1], [2]]);
    queue.dispose();
  });

  it("空队列 flush 不调用 sink", async () => {
    const harness = createHarness();
    const write = vi.fn().mockResolvedValue(undefined);
    const queue = createReportQueue({ sinks: [{ name: "noop", write }], runtime: harness.runtime });

    await queue.flush();
    expect(write).not.toHaveBeenCalled();
    queue.dispose();
  });

  it("flush 进行中入队的事件留待下一批", async () => {
    const harness = createHarness();
    const batches: number[][] = [];
    let release: (() => void) | undefined;
    const sink: Sink = {
      name: "slow",
      write: async (events) => {
        batches.push(events.map((event) => event.timestamp));
        if (release === undefined) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      }
    };
    const queue = createReportQueue({ sinks: [sink], runtime: harness.runtime });

    enqueueRange(queue, DEFAULT_BATCH_SIZE);
    await settle();
    expect(release).toBeTypeOf("function");
    // 在飞批次已按快照取走 10 条,新事件不进这一批
    expect(batches).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]);

    queue.enqueue(createEvent(100));
    expect(queue.size()).toBe(1);

    release?.();
    await queue.flush();
    expect(batches).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [100]]);
    queue.dispose();
  });
});

describe("createReportQueue 定时 flush", () => {
  it("默认每 5s 定时 flush 缓冲", async () => {
    const harness = createHarness();
    const batches: number[][] = [];
    const queue = createReportQueue({
      sinks: [createRecordingSink(batches)],
      runtime: harness.runtime
    });

    expect(harness.intervals).toHaveLength(1);
    expect(harness.intervals[0].intervalMs).toBe(DEFAULT_FLUSH_INTERVAL_MS);

    enqueueRange(queue, 2);
    expect(batches).toHaveLength(0);

    harness.tick();
    await queue.flush();
    expect(batches).toEqual([[0, 1]]);
    queue.dispose();
  });

  it("flushIntervalMs 为 0(零值)时不注册定时器", () => {
    const harness = createHarness();
    const queue = createReportQueue({ sinks: [], runtime: harness.runtime, flushIntervalMs: 0 });

    expect(harness.intervals).toHaveLength(0);
    queue.dispose();
  });

  it("dispose 清理定时器并解绑 hide,其后的入队被忽略(幂等)", () => {
    const harness = createHarness();
    const queue = createReportQueue({ sinks: [], runtime: harness.runtime });

    queue.dispose();
    expect(harness.clearedHandles).toHaveLength(1);
    expect(harness.hideUnboundTimes()).toBe(1);

    queue.enqueue(createEvent(1));
    expect(queue.size()).toBe(0);

    queue.dispose();
    expect(harness.clearedHandles).toHaveLength(1);
    expect(harness.hideUnboundTimes()).toBe(1);
  });

  it("dispose 不丢弃已缓冲事件,仍可手动 flush", async () => {
    const harness = createHarness();
    const batches: number[][] = [];
    const queue = createReportQueue({
      sinks: [createRecordingSink(batches)],
      runtime: harness.runtime,
      batchSize: DEFAULT_MAX_QUEUE_SIZE
    });

    queue.enqueue(createEvent(1));
    queue.dispose();
    await queue.flush();
    expect(batches).toEqual([[1]]);
  });
});

describe("createReportQueue app hide flush", () => {
  it("hide 回调触发 flush", async () => {
    const harness = createHarness();
    const batches: number[][] = [];
    const queue = createReportQueue({
      sinks: [createRecordingSink(batches)],
      runtime: harness.runtime
    });

    enqueueRange(queue, 3);
    expect(batches).toHaveLength(0);

    harness.hideApp();
    await queue.flush();
    expect(batches).toEqual([[0, 1, 2]]);
    queue.dispose();
  });

  it("listenAppHide 为 false 时不注册 hide 监听", () => {
    const harness = createHarness();
    const queue = createReportQueue({
      sinks: [],
      runtime: harness.runtime,
      listenAppHide: false
    });

    expect(harness.hideHandler()).toBeUndefined();
    queue.dispose();
  });

  it("默认运行时优先挂全局 Taro.onAppHide", async () => {
    const onAppHide = vi.fn();
    (globalThis as Record<string, unknown>).Taro = { onAppHide };
    const batches: number[][] = [];
    const queue = createReportQueue({
      sinks: [createRecordingSink(batches)],
      flushIntervalMs: 0
    });

    expect(onAppHide).toHaveBeenCalledTimes(1);
    queue.enqueue(createEvent(1));
    (onAppHide.mock.calls[0][0] as () => void)();
    await queue.flush();
    expect(batches).toEqual([[1]]);
    queue.dispose();
  });

  it("无 Taro 时退回全局 wx.onAppHide", () => {
    const onAppHide = vi.fn();
    (globalThis as Record<string, unknown>).wx = { onAppHide };
    const queue = createReportQueue({ flushIntervalMs: 0 });

    expect(onAppHide).toHaveBeenCalledTimes(1);
    queue.dispose();
  });

  it("Taro/wx 都缺失时不注册监听也不抛错", async () => {
    const queue = createReportQueue({ flushIntervalMs: 0 });

    queue.enqueue(createEvent(1));
    await expect(queue.flush()).resolves.toBeUndefined();
    queue.dispose();
  });
});

describe("createReportQueue 队列上限", () => {
  it("超过上限丢弃最旧的事件", async () => {
    const harness = createHarness();
    const batches: number[][] = [];
    const queue = createReportQueue({
      sinks: [createRecordingSink(batches)],
      runtime: harness.runtime,
      // 阈值拉高以关闭批量触发,单独验证上限分支
      batchSize: DEFAULT_MAX_QUEUE_SIZE * 10,
      maxQueueSize: DEFAULT_MAX_QUEUE_SIZE
    });

    enqueueRange(queue, DEFAULT_MAX_QUEUE_SIZE + 5);
    expect(queue.size()).toBe(DEFAULT_MAX_QUEUE_SIZE);

    await queue.flush();
    expect(batches[0]).toHaveLength(DEFAULT_MAX_QUEUE_SIZE);
    expect(batches[0][0]).toBe(5);
    expect(batches[0][DEFAULT_MAX_QUEUE_SIZE - 1]).toBe(DEFAULT_MAX_QUEUE_SIZE + 4);
    queue.dispose();
  });

  it("非法的 batchSize / maxQueueSize 回落默认值", async () => {
    const harness = createHarness();
    const batches: number[][] = [];
    const queue = createReportQueue({
      sinks: [createRecordingSink(batches)],
      runtime: harness.runtime,
      batchSize: 0,
      maxQueueSize: Number.NaN
    });

    enqueueRange(queue, DEFAULT_BATCH_SIZE);
    await queue.flush();
    expect(batches).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    queue.dispose();
  });
});

describe("createReportQueue 失败重试与丢弃", () => {
  it("发送失败重试 1 次后丢弃该批", async () => {
    const harness = createHarness();
    const write = vi.fn().mockRejectedValue(new Error("network down"));
    const drops: DroppedBatchInfo[] = [];
    const queue = createReportQueue({
      sinks: [{ name: "http", write }],
      runtime: harness.runtime,
      onDrop: (info) => drops.push(info)
    });

    enqueueRange(queue, DEFAULT_BATCH_SIZE);
    await queue.flush();

    expect(write).toHaveBeenCalledTimes(2);
    expect(drops).toHaveLength(1);
    expect(drops[0].sink).toBe("http");
    expect(drops[0].events).toHaveLength(DEFAULT_BATCH_SIZE);
    expect(queue.size()).toBe(0);
    queue.dispose();
  });

  it("首次失败、重试成功后不丢弃", async () => {
    const harness = createHarness();
    const write = vi.fn().mockRejectedValueOnce(new Error("flaky")).mockResolvedValue(undefined);
    const drops: DroppedBatchInfo[] = [];
    const queue = createReportQueue({
      sinks: [{ name: "http", write }],
      runtime: harness.runtime,
      onDrop: (info) => drops.push(info)
    });

    enqueueRange(queue, DEFAULT_BATCH_SIZE);
    await queue.flush();

    expect(write).toHaveBeenCalledTimes(2);
    expect(drops).toHaveLength(0);
    queue.dispose();
  });

  it("maxRetries 为 0 时不重试,直接丢弃", async () => {
    const harness = createHarness();
    const write = vi.fn().mockRejectedValue(new Error("network down"));
    const drops: DroppedBatchInfo[] = [];
    const queue = createReportQueue({
      sinks: [{ name: "http", write }],
      runtime: harness.runtime,
      maxRetries: 0,
      onDrop: (info) => drops.push(info)
    });

    enqueueRange(queue, DEFAULT_BATCH_SIZE);
    await queue.flush();

    expect(write).toHaveBeenCalledTimes(1);
    expect(drops).toHaveLength(1);
    queue.dispose();
  });

  it("某个 sink 失败不影响其他 sink 收到同一批", async () => {
    const harness = createHarness();
    const failing = { name: "http", write: vi.fn().mockRejectedValue(new Error("boom")) };
    const batches: number[][] = [];
    const drops: DroppedBatchInfo[] = [];
    const queue = createReportQueue({
      sinks: [failing, createRecordingSink(batches)],
      runtime: harness.runtime,
      onDrop: (info) => drops.push(info)
    });

    enqueueRange(queue, DEFAULT_BATCH_SIZE);
    await queue.flush();

    expect(batches).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    expect(drops.map((info) => info.sink)).toEqual(["http"]);
    queue.dispose();
  });

  it("未注入 onDrop 时用 console.warn 兜底提示", async () => {
    const harness = createHarness();
    const queue = createReportQueue({
      sinks: [{ name: "http", write: vi.fn().mockRejectedValue(new Error("down")) }],
      runtime: harness.runtime
    });

    enqueueRange(queue, DEFAULT_BATCH_SIZE);
    await queue.flush();

    expect(harness.warnings).toHaveLength(1);
    expect(String(harness.warnings[0][1])).toBe("http");
    queue.dispose();
  });

  it("未配置 sink 时 flush 直接丢弃缓冲且不抛错", async () => {
    const harness = createHarness();
    const queue = createReportQueue({ runtime: harness.runtime });

    queue.enqueue(createEvent(1));
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(queue.size()).toBe(0);
    queue.dispose();
  });
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).Taro;
  delete (globalThis as Record<string, unknown>).wx;
});
