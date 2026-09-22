// 埋点 facade(方案见 docs/site-shell-plan.md 决策 2):对业务只暴露 track /
// trackPageView 两个方法(禁止事件队列/离线持久化/批量缓冲),内部把事件分发给
// 可插拔 sink(./sinks)。
//
// 开关门控:经 config/features.ts 的 tracking 开关(TRACK_ENDPOINT 缺失强制关);
// 未启用时默认 sink 组合为空,track/trackPageView/initTracking 整体 no-op。
// 装配:layout(阶段 5)在客户端挂载时调用 initTracking() 注册 web-vitals 上报。
import { siteEnv, type SiteEnv } from "../config/env";
import { readFeatureFlags } from "../config/features";
import {
  toWebVitalsPayload,
  type PageViewPayload,
  type TrackingEvent,
  type TrackingPayload,
  type TrackingPayloadMap,
  type WebVitalsMetricInput
} from "../config/tracking-events";
import { createConsoleSink, createHttpSink, createRumSink, type TrackingSink } from "./sinks";

export interface TrackingFacade {
  track: <K extends TrackingEvent>(event: K, payload?: TrackingPayloadMap[K]) => void;
  trackPageView: (params: PageViewPayload) => void;
}

// 创建 facade 实例:按注册顺序逐 sink 分发;单个 sink 同步抛错被捕获,不影响其余
// sink 与调用方(异步失败由各 sink 自行静默,见 ./sinks)。
export function createTrackingFacade(sinks: TrackingSink[]): TrackingFacade {
  const dispatch = (event: TrackingEvent, payload?: TrackingPayload): void => {
    for (const sink of sinks) {
      try {
        sink.send(event, payload);
      } catch {
        // 埋点失败静默,不允许影响站点功能。
      }
    }
  };
  return {
    track: (event, payload) => dispatch(event, payload),
    trackPageView: (params) => {
      // referrer 未显式提供时浏览器侧兜底 document.referrer(空串视为无来源)。
      const referrer =
        params.referrer ??
        (typeof document === "undefined" ? undefined : document.referrer || undefined);
      dispatch("page_view", referrer === undefined ? params : { ...params, referrer });
    }
  };
}

// 默认 sink 组合(tracking 关 → 空数组 = 整体 no-op):
// - console:dev(NODE_ENV 非 production)默认注册,观测本地事件流;
// - RUM:RUM 配置齐全才注册(内部判空返回 null,见 ./sinks 的 createRumSink);
// - HTTP:tracking 开启即蕴含 TRACK_ENDPOINT 非空(features.ts 派生),恒注册。
export function createDefaultSinks(env: SiteEnv = siteEnv): TrackingSink[] {
  if (!readFeatureFlags(env).tracking) {
    return [];
  }
  const sinks: TrackingSink[] = [];
  if (process.env.NODE_ENV !== "production") {
    sinks.push(createConsoleSink());
  }
  const rumSink = createRumSink();
  if (rumSink) {
    sinks.push(rumSink);
  }
  sinks.push(createHttpSink(env.trackEndpoint));
  return sinks;
}

const defaultSinks = createDefaultSinks();
const defaultFacade = createTrackingFacade(defaultSinks);

/** 上报注册表内的事件(类型安全入口,事件与载荷定义见 config/tracking-events.ts)。 */
export const track: TrackingFacade["track"] = (event, payload) => {
  defaultFacade.track(event, payload);
};

/** 上报页面浏览事件;referrer 未提供时浏览器侧兜底 document.referrer。 */
export function trackPageView(params: PageViewPayload): void {
  defaultFacade.trackPageView(params);
}

// 注册 CLS/LCP/INP/FCP/TTFB 五类核心指标上报:动态 import("web-vitals"),
// client-only(typeof window 守卫,SSR 不执行);未启用(无 sink)时不拉取产物。
// sinks 参数供测试注入;生产装配(layout 阶段 5)无参调用走默认组合。
export function initTracking(sinks: TrackingSink[] = defaultSinks): void {
  if (typeof window === "undefined" || sinks.length === 0) {
    return;
  }
  const facade = createTrackingFacade(sinks);
  void import("web-vitals")
    .then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
      const report = (metric: WebVitalsMetricInput): void => {
        facade.track("web_vitals", toWebVitalsPayload(metric));
      };
      onCLS(report);
      onFCP(report);
      onINP(report);
      onLCP(report);
      onTTFB(report);
    })
    .catch(() => {
      // 指标库加载失败静默,不影响站点功能。
    });
}
