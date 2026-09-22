// core/stability:稳定性能力(ErrorBoundary + 白屏检测,方案 docs/h5-shell-plan.md §3)。
//
// 全局错误/unhandledrejection/资源错误捕获接线归阶段 2.A(core/monitor 侧),
// TODO(阶段 2.A):window error/unhandledrejection → getReporter() 上报。
//
// 依赖方向硬规则(同 core/monitor):core → config 允许;core 禁止 import routes/store;
// 上报一律经 core/monitor 的 getReporter() 接口,禁止直连监控 SDK。

/** 稳定性上报 kind 字面量(core/monitor 的 ReportPayload.kind 为 string,此处钉住本模块取值)。 */
export type StabilityErrorKind = "react_render_error" | "white_screen";

/** 稳定性错误载荷:形状与 core/monitor 的 ReportPayload 对齐,可直接作为上报实参转发。 */
export interface StabilityError {
  kind: StabilityErrorKind;
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
}

/** 白屏检测入参(rootSelector/timeoutMs 由阶段 1.B 钉住;定时器两项为阶段 2.C 的可注入口)。 */
export interface WhiteScreenCheckOptions {
  /** 根节点选择器,默认按 Modern.js 挂载点传 "#root"。 */
  rootSelector: string;
  /** 挂载超时(毫秒),超时仍判空则视为白屏。 */
  timeoutMs: number;
  /** 可注入定时器(测试用):缺省 window.setTimeout,返回句柄原样传给 cancelTimer。 */
  scheduleTimer?: (callback: () => void, timeoutMs: number) => unknown;
  /** 可注入定时器(测试用):缺省 window.clearTimeout。 */
  cancelTimer?: (handle: unknown) => void;
}

export { captureRenderError, ErrorBoundary } from "./error-boundary";
export {
  DEFAULT_WHITE_SCREEN_TIMEOUT_MS,
  isRootEmpty,
  startWhiteScreenCheck
} from "./white-screen";
