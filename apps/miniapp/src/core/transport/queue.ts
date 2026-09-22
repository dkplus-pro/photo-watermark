// core/transport 批量上报队列。
//
// 行为契约(见 docs/miniapp-shell-plan.md §4、§5 阶段 1.2):
// - 攒满 batchSize(默认 10)条立即 flush,或每 flushIntervalMs(默认 5s)定时 flush;
// - app hide(Taro/wx 生命周期)时 flush,避免切后台丢缓冲;
// - 队列上限 maxQueueSize(默认 100),溢出丢最旧;
// - 发送失败重试 maxRetries(默认 1)次,再失败丢弃该批(不阻塞后续事件)。
//
// 可测试性:Taro/wx 调用与定时器全部来自注入的 TransportRuntime(默认实现读 globalThis),
// 单测用假运行时即可完整驱动各分支,不需要真实小程序环境。
// 零依赖:本文件同样不 import 任何第三方包。

import {
  defaultTransportRuntime,
  TRANSPORT_LOG_PREFIX,
  type Sink,
  type TransportEvent,
  type TransportRuntime
} from "./sink";

/** 批量阈值:攒满即 flush。 */
export const DEFAULT_BATCH_SIZE = 10;
/** 定时 flush 间隔(ms)。 */
export const DEFAULT_FLUSH_INTERVAL_MS = 5000;
/** 队列上限,溢出丢最旧。 */
export const DEFAULT_MAX_QUEUE_SIZE = 100;
/** 发送失败重试次数(总尝试次数 = maxRetries + 1)。 */
export const DEFAULT_MAX_RETRIES = 1;

/** 一批事件被丢弃时的信息(重试耗尽)。 */
export interface DroppedBatchInfo {
  /** 丢弃发生在哪个 sink(取 Sink.name) */
  readonly sink: string;
  /** 被丢弃的事件(按 sink 维度整批丢弃,不重新入队) */
  readonly events: readonly TransportEvent[];
  /** 最后一次失败原因 */
  readonly error: unknown;
}

export interface ReportQueueOptions {
  /** 上报终端,按序依次写出;未配置则 flush 时直接丢弃 */
  sinks?: readonly Sink[];
  /** 批量阈值,默认 10;非法值(<=0 / 非有限数)回落默认值 */
  batchSize?: number;
  /** 定时 flush 间隔(ms),默认 5000;传 0 关闭定时 flush */
  flushIntervalMs?: number;
  /** 队列上限,默认 100;非法值回落默认值 */
  maxQueueSize?: number;
  /** 失败重试次数,默认 1 */
  maxRetries?: number;
  /** 是否自动注册 app hide flush,默认 true(便于按需关闭) */
  listenAppHide?: boolean;
  /** 重试耗尽后的丢弃回调,默认打 console.warn */
  onDrop?: (info: DroppedBatchInfo) => void;
  /** 注入的宿主能力(全局对象 + 定时器),默认走 globalThis */
  runtime?: TransportRuntime;
}

export interface ReportQueue {
  /** 入队;达到批量阈值立即触发 flush(触发式,不等待结果) */
  enqueue(event: TransportEvent): void;
  /** 手动 flush(如 app hide、页面卸载);并发调用串行执行,永不 reject */
  flush(): Promise<void>;
  /** 当前缓冲条数(诊断用) */
  size(): number;
  /** 停掉定时器与 hide 监听(不丢已缓冲事件,仍可手动 flush) */
  dispose(): void;
}

function normalizeCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function createDropLogger(runtime: TransportRuntime): (info: DroppedBatchInfo) => void {
  return (info) => {
    runtime
      .getConsole()
      ?.warn?.(
        `${TRANSPORT_LOG_PREFIX} 上报失败,已丢弃 ${info.events.length} 条`,
        info.sink,
        info.error
      );
  };
}

// 单 sink 写一批:失败重试 maxRetries 次;返回最后一次错误(成功返回 undefined)。
async function writeWithRetry(
  sink: Sink,
  batch: readonly TransportEvent[],
  maxRetries: number
): Promise<unknown> {
  let lastError: unknown = undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await sink.write(batch);
      return undefined;
    } catch (error) {
      lastError = error;
    }
  }
  return lastError;
}

export function createReportQueue(options: ReportQueueOptions = {}): ReportQueue {
  const runtime = options.runtime ?? defaultTransportRuntime;
  const sinks = options.sinks ?? [];
  const batchSize = normalizeCount(options.batchSize, DEFAULT_BATCH_SIZE);
  const maxQueueSize = normalizeCount(options.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE);
  const flushIntervalMs = Math.max(0, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  const onDrop = options.onDrop ?? createDropLogger(runtime);

  const buffer: TransportEvent[] = [];
  let disposed = false;
  // flush 串行链:并发调用(定时 + hide + 阈值)不会同时写同一批事件
  let flushing: Promise<void> = Promise.resolve();

  // 未配置 sink 时整批丢弃:壳装配总会给出至少一个 sink,这里只兜底不报错。
  async function writeBatch(batch: readonly TransportEvent[]): Promise<void> {
    for (const sink of sinks) {
      const error = await writeWithRetry(sink, batch, maxRetries);
      if (error !== undefined) onDrop({ sink: sink.name, events: batch, error });
    }
  }

  function drain(): Promise<void> {
    const batch = buffer.splice(0, buffer.length);
    if (batch.length === 0 || sinks.length === 0) return Promise.resolve();
    return writeBatch(batch);
  }

  function flush(): Promise<void> {
    flushing = flushing.then(drain, drain);
    return flushing;
  }

  function enqueue(event: TransportEvent): void {
    if (disposed) return;
    buffer.push(event);
    // 溢出丢最旧:只保留最近 maxQueueSize 条
    while (buffer.length > maxQueueSize) buffer.shift();
    if (buffer.length >= batchSize) void flush();
  }

  const timerHandle =
    flushIntervalMs > 0 ? runtime.setInterval(() => void flush(), flushIntervalMs) : undefined;
  const unbindAppHide =
    options.listenAppHide === false ? undefined : runtime.onAppHide(() => void flush());

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (timerHandle !== undefined) runtime.clearInterval(timerHandle);
    unbindAppHide?.();
  }

  return {
    enqueue,
    flush,
    size: () => buffer.length,
    dispose
  };
}
