// core/track:埋点 facade(方案 docs/miniapp-shell-plan.md §5 阶段 2.2)。
//
// 数据流:track()/pageView() → 总开关+采样 → 公共参数组装 → transport 队列 → sink。
// 业务只面向本模块的 track/pageView,禁止绕过 facade 直接操作队列或 sink;
// 依赖方向硬规则同 core/monitor(见 apps/miniapp/AGENTS.md §1)。
import {
  appConfig,
  getAppVersion,
  getBuildTime,
  TRACK_ENABLED,
  TRACK_SAMPLE_RATE,
  TRACK_ENDPOINT
} from "../../config";
import { createReportQueue, type ReportQueue } from "../transport/queue";
import { createTransportSinks } from "../transport/sink";
import { collectCommonParams, refreshNetworkType, type CommonParams } from "./params";

/** 内建事件类型:page_view(页面曝光)/ click(点击)/ expose(元素曝光)/ custom(自定义) */
export type TrackEventType = "page_view" | "click" | "custom" | "expose";

/** 事件负载:值必须可 JSON 序列化(进 transport 队列批量上报)。 */
export type EventProps = Record<string, unknown>;

/** 单条埋点记录(TransportEvent 的业务扩展,经结构类型进队列)。 */
export interface TrackEventRecord {
  event: string;
  timestamp: number;
  level: "info";
  props: EventProps & CommonParams;
}

/** 采样判定:rate 越界/非法回退全采(与 miniapp 配置坑语义一致);random 可注入。 */
export function isSampled(rate: number | undefined, random: () => number = Math.random): boolean {
  const effective =
    typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 1;
  if (effective >= 1) return true;
  if (effective <= 0) return false;
  return random() < effective;
}

export interface CreateTrackerOptions {
  /** 注入队列(单测);缺省按环境表组装 transport 队列 */
  queue?: ReportQueue;
  /** 注入总开关(单测);缺省读环境表 TRACK_ENABLED */
  enabled?: boolean;
  /** 注入采样率(单测);缺省读环境表 TRACK_SAMPLE_RATE */
  sampleRate?: number;
  /** 注入随机源(单测) */
  random?: () => number;
  /** 注入公共参数(单测);缺省实时收集 */
  commonParams?: () => CommonParams;
  /** 注入时间源(单测) */
  now?: () => number;
}

export interface Tracker {
  /** 自定义/点击事件;name 用 `资源.动作` 蛇形命名(对齐 server oplog 规范) */
  track(name: string, props?: EventProps): void;
  /** 页面曝光:内建 page_view 事件,path 为页面路径 */
  pageView(path: string, props?: EventProps): void;
  /** 元素曝光:trackId 为埋点位标识;同页面实例去重由调用侧(useExpose/ExposeView)承担 */
  expose(trackId: string, props?: EventProps): void;
  /** 手动 flush(页面卸载/app hide 补充;队列自身也有定时与 hide flush) */
  flush(): Promise<void>;
}

export function createTracker(options: CreateTrackerOptions = {}): Tracker {
  const queue =
    options.queue ??
    createReportQueue({
      sinks: createTransportSinks({ dev: false, httpEndpoint: TRACK_ENDPOINT })
    });
  const enabled = options.enabled ?? TRACK_ENABLED;
  const sampleRate = options.sampleRate ?? TRACK_SAMPLE_RATE;
  const random = options.random ?? Math.random;
  const commonParams =
    options.commonParams ??
    (() => collectCommonParams({ version: getAppVersion(), buildTime: getBuildTime() }));
  const now = options.now ?? (() => Date.now());

  function enqueue(eventType: TrackEventType, name: string, props: EventProps): void {
    if (!enabled || !isSampled(sampleRate, random)) {
      return;
    }
    const record: TrackEventRecord = {
      event: `track.${eventType}`,
      timestamp: now(),
      level: "info",
      props: { name, ...commonParams(), ...props }
    };
    queue.enqueue(record);
  }

  return {
    track(name, props = {}) {
      const eventType: TrackEventType = name === "click" ? "click" : "custom";
      enqueue(eventType, name, props);
    },
    pageView(path, props = {}) {
      enqueue("page_view", "page_view", { path, ...props });
    },
    expose(trackId, props = {}) {
      // 空 trackId 直接丢弃(空值护栏,不产出无归属事件)
      if (typeof trackId !== "string" || trackId.trim() === "") return;
      enqueue("expose", "expose", { trackId, ...props });
    },
    flush() {
      return queue.flush();
    }
  };
}

// 刷新网络类型缓存(埋点携带的网络字段尽量新鲜;失败静默保持旧值)。
refreshNetworkType();

/** 业务侧单例:app 启动后所有页面共享一个队列与 sink 组合。 */
export const tracker = createTracker();

/** 业务入口:自定义/点击事件。 */
export function track(name: string, props?: EventProps): void {
  tracker.track(name, props);
}

/** 业务入口:页面曝光。 */
export function pageView(path: string, props?: EventProps): void {
  tracker.pageView(path, props);
}

/** 业务入口:元素曝光(事件名 track.expose)。 */
export function expose(trackId: string, props?: EventProps): void {
  tracker.expose(trackId, props);
}

/** app 级手动 flush 透出(app.tsx onShow/hide 接线用)。 */
export function flushTrack(): Promise<void> {
  return tracker.flush();
}

// appConfig 引用保留:env 表是配置唯一入口,此处显式标注依赖关系(core → config 允许)。
void appConfig;
