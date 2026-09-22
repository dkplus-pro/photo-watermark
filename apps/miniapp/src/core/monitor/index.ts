// core/monitor:错误监控 facade(方案 docs/miniapp-shell-plan.md §5 阶段 2.1)。
//
// 数据流:captureError/captureMessage → 总开关+采样 → transport 队列 → sink。
// 业务与壳只面向本模块 API;全局钩子经 createGlobalHooks 由 app.tsx 一行接线(阶段 N3)。
// 依赖方向硬规则见 apps/miniapp/AGENTS.md §1(core → config 允许;模块间互不依赖,
// 采样判定在 track/monitor 各自内联,保持模块独立)。
import { MONITOR_ENDPOINT, MONITOR_ENABLED, MONITOR_SAMPLE_RATE, getAppVersion, getBuildTime } from "../../config";
import { createReportQueue, type ReportQueue } from "../transport/queue";
import type { TransportEvent } from "../transport/sink";
import { createTransportSinks } from "../transport/sink";

/** 错误类别:js(wx onError)/ api(client.ts 请求链)/ unhandled_rejection / page_not_found */
export type MonitorErrorKind =
  | "js_error"
  | "api_error"
  | "unhandled_rejection"
  | "page_not_found";

/** 监控载荷:与 transport 事件结构对齐,message 写人话,stack/extra 可缺省。 */
export interface MonitorPayload {
  kind: MonitorErrorKind;
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
}

export interface CreateMonitorOptions {
  /** 注入队列(单测);缺省按环境表组装 transport 队列 */
  queue?: ReportQueue;
  /** 注入总开关(单测);缺省读环境表 MONITOR_ENABLED */
  enabled?: boolean;
  /** 注入采样率(单测);缺省读环境表 MONITOR_SAMPLE_RATE */
  sampleRate?: number;
  /** 注入随机源(单测) */
  random?: () => number;
  /** 注入时间源(单测) */
  now?: () => number;
}

export interface Monitor {
  /** 捕获错误;payload 已规范化的直接透传,规范化辅助见 normalizeError */
  captureError(payload: MonitorPayload): void;
  /** 捕获消息(白屏、异常状态等非异常对象场景) */
  captureMessage(kind: MonitorErrorKind, message: string, extra?: Record<string, unknown>): void;
  /** 手动 flush(app hide 补充;队列自身也有定时 flush) */
  flush(): Promise<void>;
}

/** 采样判定:rate 越界/非法回退全采(与 track 同语义;模块独立故各自内联)。 */
export function isMonitorSampled(
  rate: number | undefined,
  random: () => number = Math.random
): boolean {
  const effective =
    typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 1;
  if (effective >= 1) return true;
  if (effective <= 0) return false;
  return random() < effective;
}

export function createMonitor(options: CreateMonitorOptions = {}): Monitor {
  const queue =
    options.queue ??
    createReportQueue({
      sinks: createTransportSinks({ dev: false, httpEndpoint: MONITOR_ENDPOINT })
    });
  const enabled = options.enabled ?? MONITOR_ENABLED;
  const sampleRate = options.sampleRate ?? MONITOR_SAMPLE_RATE;
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => Date.now());

  function enqueue(kind: MonitorErrorKind, message: string, stack?: string, extra?: Record<string, unknown>): void {
    if (!enabled || !isMonitorSampled(sampleRate, random)) {
      return;
    }
    // 业务扩展字段经结构类型入队(TransportEvent 只声明自有字段)
    const record: TransportEvent & {
      props: Record<string, unknown>;
    } = {
      event: `monitor.${kind}`,
      timestamp: now(),
      level: kind === "page_not_found" ? "warn" : "error",
      props: { kind, message, stack, extra, version: getAppVersion(), buildTime: getBuildTime() }
    };
    queue.enqueue(record);
  }

  return {
    captureError(payload) {
      enqueue(payload.kind, payload.message, payload.stack, payload.extra);
    },
    captureMessage(kind, message, extra) {
      enqueue(kind, message, undefined, extra);
    },
    flush() {
      return queue.flush();
    }
  };
}

/** 业务侧单例:app 启动后全局共享(全局钩子与请求链错误都汇入这里)。 */
export const monitor = createMonitor();

// 规范化工具同属本模块公开 API(app.tsx/client.ts 一行接线用;type-only 循环引用无运行时环)。
export {
  normalizeApiError,
  normalizeJsError,
  normalizePageNotFound,
  normalizeUnhandledRejection
} from './normalize';

/** 业务入口:捕获错误。 */
export function captureError(payload: MonitorPayload): void {
  monitor.captureError(payload);
}

/** 业务入口:捕获消息。 */
export function captureMessage(kind: MonitorErrorKind, message: string, extra?: Record<string, unknown>): void {
  monitor.captureMessage(kind, message, extra);
}

/** app 级手动 flush 透出(app.tsx hide 接线用)。 */
export function flushMonitor(): Promise<void> {
  return monitor.flush();
}
