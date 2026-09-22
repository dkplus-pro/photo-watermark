/**
 * 渲染层埋点 sdk(docs/desktop-shell-plan.md §2):
 * - pageView/event 事件先进内存批量队列,满批/定时/pagehide 时整批经
 *   window.desktop.report.track 发往主进程 transport(渲染层禁直连上报端点);
 * - 开关门控:rendererEnv.trackDisabled(VITE_TRACK_DISABLED=true)强制关,dev 构建
 *   默认关(同 site RUM 模式);关闭时 track/trackPageView 整体 no-op;
 * - 无桥/上报失败时可选链降级 console.debug 并静默丢弃,埋点不允许反噬业务;
 * - 渲染层禁 ipcRenderer 直用,业务代码只调本模块,禁止手写上报 HTTP。
 */
import { rendererEnv } from "../config";
import { getDesktopBridge } from "./bridge";

// 事件载荷:仅可序列化基础字段(snake_case,与主进程 transport 透传约定一致)。
export type TrackEventPayload = Record<string, string | number | boolean | undefined>;

// 批量参数:与主进程 transport 的满批阈值/定时同参数量级,渲染层先行攒批减少 IPC 往返。
const FLUSH_BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5000;

// 单条待发事件;上报载荷 = 事件名 + 载荷 + 时间戳,事件名由调用方语义化命名。
export interface QueuedTrackEvent {
  event: string;
  payload?: TrackEventPayload;
  ts: number;
}

let queue: QueuedTrackEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pagehideHooked = false;

// 埋点总开关:强制关或 dev 构建(默认关)时整体 no-op。模块加载期判定一次。
const trackingEnabled = !rendererEnv.trackDisabled && !rendererEnv.dev;

function scheduleFlush(): void {
  if (flushTimer !== null) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushTrackQueue();
  }, FLUSH_INTERVAL_MS);
}

function queueEvent(event: string, payload?: TrackEventPayload): void {
  if (!trackingEnabled) {
    return;
  }
  queue.push({ event, payload, ts: Date.now() });
  if (queue.length >= FLUSH_BATCH_SIZE) {
    void flushTrackQueue();
    return;
  }
  scheduleFlush();
}

/**
 * 整批发送当前队列;返回是否真正发出(供测试断言)。
 * 队列为空或无桥时返回 false;发送失败静默丢弃(渲染层无持久化,重试由主进程 transport 负责)。
 */
export function flushTrackQueue(): Promise<boolean> {
  if (queue.length === 0) {
    return Promise.resolve(false);
  }
  const batch = queue;
  queue = [];
  try {
    const bridge = getDesktopBridge();
    if (!bridge?.report) {
      // eslint-disable-next-line no-console -- 无桥降级观测(卡片要求的静默降级通道)
      console.debug(`[track] desktop 桥缺失,丢弃 ${batch.length} 条埋点`);
      return Promise.resolve(false);
    }
    return bridge.report.track(batch).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

/** 上报自定义事件(事件名语义化,如 `app.launch`);关闭时 no-op。 */
export function trackEvent(event: string, payload?: TrackEventPayload): void {
  queueEvent(event, payload);
}

/** 上报页面浏览(事件名固定 page_view,payload 记录路由路径);关闭时 no-op。 */
export function trackPageView(path: string): void {
  queueEvent("page_view", { path });
}

/**
 * 注册 pagehide 兜底 flush(窗口关闭/刷新前尽力发完存量队列,异步发送不保证送达)。
 * 幂等;非浏览器环境不初始化;返回埋点开关是否开启(供测试断言)。
 */
export function initTrack(): boolean {
  if (typeof window === "undefined" || pagehideHooked) {
    return trackingEnabled;
  }
  pagehideHooked = true;
  window.addEventListener("pagehide", () => {
    void flushTrackQueue();
  });
  return trackingEnabled;
}
