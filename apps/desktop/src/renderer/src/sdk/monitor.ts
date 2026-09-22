/**
 * 渲染层错误采集 sdk(docs/desktop-shell-plan.md §2):
 * - 全局 error / unhandledrejection 采集 + 对外暴露 reportRenderError(渲染边界复用),
 *   统一经 window.desktop.report.error 发往主进程 transport 批量上报;
 * - 渲染层不判 endpoint:DESKTOP_REPORT_* 缺失时主进程管道整体不初始化,渲染层只管发;
 * - 幂等:initMonitor 重复调用只注册一次,返回是否真正初始化(供测试断言);
 * - 无桥/上报失败时可选链降级 console.debug 并静默,监控管道不允许反噬业务;
 * - 渲染层禁 ipcRenderer 直用、禁直连上报端点,只认 window.desktop.* 桥。
 */
import { getDesktopBridge } from "./bridge";

// 错误来源:window_error 全局 error 事件 / unhandled_rejection 未处理的 Promise 拒绝 /
// react_render_error 渲染边界捕获(component/error-boundary.tsx)。
export type MonitorErrorKind = "window_error" | "unhandled_rejection" | "react_render_error";

// 上报载荷:仅可序列化基础字段(snake_case,与主进程 transport 透传约定一致)。
export interface MonitorErrorPayload {
  kind: MonitorErrorKind;
  message: string;
  stack?: string;
  /** window_error 场景:脚本来源与行列号 */
  source?: string;
  line?: number;
  column?: number;
  /** react_render_error 场景:React 组件栈 */
  component_stack?: string;
  /** 事件时间戳(epoch ms) */
  ts: number;
}

let initialized = false;

// 发送单条错误:无桥降级 console.debug,同步/异步异常均静默。
function sendError(payload: MonitorErrorPayload): void {
  try {
    const bridge = getDesktopBridge();
    if (!bridge?.report) {
      // eslint-disable-next-line no-console -- 无桥降级观测(卡片要求的静默降级通道)
      console.debug("[monitor] desktop 桥缺失,错误仅本地记录:", payload.message);
      return;
    }
    void bridge.report.error(payload).catch(() => {
      // 上报失败静默:监控不允许反噬业务。
    });
  } catch {
    // 同步异常同样静默。
  }
}

/** 供渲染边界(ErrorBoundary)上报已捕获的渲染错误。 */
export function reportRenderError(error: Error, componentStack?: string | null): void {
  sendError({
    kind: "react_render_error",
    message: error.message,
    stack: error.stack,
    component_stack: componentStack ?? undefined,
    ts: Date.now()
  });
}

/**
 * 注册全局错误采集(window.onerror 语义的 error 事件 + unhandledrejection)。
 * 幂等;非浏览器环境不初始化;返回是否真正初始化(供测试断言)。
 */
export function initMonitor(): boolean {
  if (typeof window === "undefined" || initialized) {
    return false;
  }
  initialized = true;

  window.addEventListener("error", (event) => {
    // 资源加载失败(src/href 404 等)派发的是普通 Event 且无错误信息,不属于可诊断的
    // 脚本错误,跳过避免噪音。
    if (!(event instanceof ErrorEvent)) {
      return;
    }
    sendError({
      kind: "window_error",
      message: event.message || "unknown error",
      stack: event.error?.stack,
      source: event.filename || undefined,
      line: event.lineno,
      column: event.colno,
      ts: Date.now()
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    sendError({
      kind: "unhandled_rejection",
      message: reason instanceof Error ? reason.message : String(reason ?? "unknown reason"),
      stack: reason instanceof Error ? reason.stack : undefined,
      ts: Date.now()
    });
  });

  return true;
}
