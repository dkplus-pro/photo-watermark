// 三类可插拔 sink(方案见 docs/site-shell-plan.md 决策 2):console(dev 观测)、
// ARMS RUM 自定义事件、HTTP(sendBeacon 优先 + fetch keepalive 兜底)。
// 约束:所有发送失败一律静默,不冒泡、不重试、不建事件队列(facade 层另有逐 sink
// try/catch 兜底,见 ./index;这里静默的是各 sink 的内部异步失败)。
import { readRumConfig } from "../config/rum";
import type { TrackingEvent, TrackingPayload } from "../config/tracking-events";

export type TrackingSinkName = "console" | "rum" | "http";

// sink 统一接口:facade 按注册顺序逐个分发,payload 缺省由各 sink 自行兜底。
export interface TrackingSink {
  readonly name: TrackingSinkName;
  send(event: TrackingEvent, payload?: TrackingPayload): void;
}

/** console sink:dev 观测默认通道,信息级输出一行完整上下文。 */
export function createConsoleSink(): TrackingSink {
  return {
    name: "console",
    send(event, payload) {
      console.info(`[tracking] ${event}`, payload ?? {});
    }
  };
}

// ARMS RUM 自定义事件的输入形状(仅声明用到的字段,与 @arms/rum-core 的 RumCustomEvent
// 对齐:type/name 必填、value 数值、properties 载荷;不直接依赖 rum-core 的类型导出)。
interface RumCustomEventInput {
  event_type: "custom";
  type: "custom";
  name: string;
  value: number;
  properties?: Record<string, unknown>;
}

// @arms/rum-browser 动态 import 后消费的命名导出(自定义事件广播 API,见其 shell.d.ts:
// sendEvent → Shell.broadcastEvent,广播给已初始化的 SDK 实例)。
interface RumBrowserModule {
  sendEvent?: (event: RumCustomEventInput) => void;
}

// 载荷中的数值 value(web_vitals 的指标值);page_view 等无 value 载荷按 1 计数。
function readPayloadValue(payload: TrackingPayload | undefined): number {
  if (payload && "value" in payload && typeof payload.value === "number") {
    return payload.value;
  }
  return 1;
}

/**
 * RUM sink:把事件转成 ARMS 自定义事件广播给已初始化的 SDK 实例。
 * - RUM 配置(RUM_ENDPOINT/RUM_PID 任一缺失)时返回 null,调用方不注册该 sink;
 * - SDK 初始化由 config/rum.ts 的 initRum 负责(layout 装配),本 sink 只广播,
 *   未初始化时广播为 no-op;
 * - 仅浏览器执行,SSR 下跳过。
 */
export function createRumSink(): TrackingSink | null {
  if (!readRumConfig()) {
    return null;
  }
  return {
    name: "rum",
    send(event, payload) {
      if (typeof window === "undefined") {
        return;
      }
      void import("@arms/rum-browser")
        .then((mod) => {
          // 最小接口断言(与 config/rum.ts 同款写法):只消费自定义事件广播 API。
          const sendEvent = (mod as unknown as RumBrowserModule).sendEvent;
          if (!sendEvent) {
            return;
          }
          sendEvent({
            event_type: "custom",
            type: "custom",
            name: event,
            // ARMS 自定义事件 value 为数值聚合维度:载荷自带数值 value 用之,否则按 1 计数。
            value: readPayloadValue(payload),
            properties: { ...payload }
          });
        })
        .catch(() => {
          // SDK 加载/广播失败静默,不影响站点功能。
        });
    }
  };
}

/**
 * HTTP sink:自定义埋点端点上报(TRACK_ENDPOINT 配置坑)。
 * - sendBeacon 优先(页面卸载也能送达),API 不可用或返回 false 时降级 fetch keepalive;
 * - fetch 失败静默(不冒泡、不重试);
 * - 埋点是浏览器行为,SSR(node)下直接跳过。
 */
export function createHttpSink(endpoint: string): TrackingSink {
  return {
    name: "http",
    send(event, payload) {
      if (typeof window === "undefined") {
        return;
      }
      const body = JSON.stringify({ event, payload: payload ?? {}, timestamp: Date.now() });
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        if (navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }))) {
          return;
        }
      }
      void fetch(endpoint, {
        method: "POST",
        body,
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        credentials: "omit"
      }).catch(() => {
        // 发送失败静默:埋点失败不允许影响站点功能。
      });
    }
  };
}
