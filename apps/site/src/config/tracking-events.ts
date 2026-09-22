// 埋点事件注册表(方案见 docs/site-shell-plan.md 阶段 4.1):事件名与载荷字段类型
// 集中在此定义,是站点级自定义事件的唯一类型安全入口。
//
// 扩展规范:
// 1. 事件名用 snake_case;新增事件先在本文件声明载荷类型(字段须为可序列化基础
//    类型,供 JSON 与 ARMS BaseObject 双通道上报),再同步登记 TRACKING_EVENTS 与
//    TrackingPayloadMap,facade 的 track 才能以类型安全方式使用该事件;
// 2. 禁止在注册表之外散写字符串事件名:track 的 event 参数类型收口在 TrackingEvent
//    (由 TrackingPayloadMap 键派生),未登记的事件无法通过编译;
// 3. 载荷若带数值 value 字段,RUM 通道会把它作为自定义事件的聚合维度(缺省按 1
//    计数,求和即发生次数,见 src/tracking/sinks.ts);
// 4. 业务级埋点规范(命名空间/字段字典)等有真实业务再定(docs/site-shell-plan.md §6)。

/** page_view 载荷:页面浏览事件(trackPageView 的入参)。 */
export type PageViewPayload = {
  /** 当前页面路径(如 "/" 或 "/posts/1")。 */
  path: string;
  /** 来源页;未提供时浏览器侧由 facade 兜底取 document.referrer(空串视为无来源)。 */
  referrer?: string;
};

/** web_vitals 载荷:CLS/LCP/INP/FCP/TTFB 五类核心 Web 指标上报。 */
export type WebVitalsPayload = {
  /** 指标缩写名。 */
  metric: "CLS" | "LCP" | "INP" | "FCP" | "TTFB";
  /** 指标当前值(CLS 无量纲,其余毫秒)。 */
  value: number;
  /** 指标阈值评级。 */
  rating: "good" | "needs-improvement" | "poor";
  /** 本次页面加载的指标实例 ID(上报侧用于去重/聚合)。 */
  id: string;
  /** 相对上次上报的增量(首次上报等于 value)。 */
  delta: number;
  /** 导航类型(navigate/reload/back-forward 等);缺失时不下发。 */
  navigation_type?: string;
};

/** 事件名 → 载荷类型映射:注册表本体,新事件必须在此登记载荷类型。 */
/** api_error 载荷:接口最终失败(重试后仍失败)的上报,由 api/client.ts 发出。 */
export interface ApiErrorPayload {
  /** 请求路径(相对或绝对) */
  endpoint: string;
  /** 人话失败原因(信封 message 或 HTTP 状态兜底) */
  message: string;
  /** HTTP 状态码;网络失败无响应时为 0 */
  status: number;
}

/** react_render_error 载荷:ErrorBoundary 捕获的渲染错误。 */
export interface RenderErrorPayload {
  /** error.message */
  message: string;
  /** React 组件栈(可能缺省) */
  component_stack?: string;
}

export interface TrackingPayloadMap {
  page_view: PageViewPayload;
  web_vitals: WebVitalsPayload;
  api_error: ApiErrorPayload;
  react_render_error: RenderErrorPayload;
}

/** 埋点事件名类型(track 的 event 参数),由注册表键派生。 */
export type TrackingEvent = keyof TrackingPayloadMap;

/** 任意事件的载荷类型(sink 接口用)。 */
export type TrackingPayload = TrackingPayloadMap[TrackingEvent];

// 事件名运行时常量:键集合经 Record<TrackingEvent, ...> 与注册表双向绑定,
// 两边失同步会直接编译报错。
export const TRACKING_EVENTS: Record<TrackingEvent, TrackingEvent> = {
  page_view: "page_view",
  web_vitals: "web_vitals",
  api_error: "api_error",
  react_render_error: "react_render_error"
};

/** web-vitals 回调入参的结构化最小集(兼容 web-vitals 各 Metric 类型,便于单测)。 */
export interface WebVitalsMetricInput {
  name: WebVitalsPayload["metric"];
  value: number;
  rating: WebVitalsPayload["rating"];
  id: string;
  delta: number;
  navigationType?: string;
}

// 指标 → web_vitals 事件载荷的纯映射(web-vitals 接入的唯一转换逻辑,便于单测)。
export function toWebVitalsPayload(metric: WebVitalsMetricInput): WebVitalsPayload {
  return {
    metric: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    delta: metric.delta,
    ...(metric.navigationType ? { navigation_type: metric.navigationType } : {})
  };
}
