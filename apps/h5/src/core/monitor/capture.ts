import type { ReportPayload, Reporter } from "./index";

// 全局错误捕获接线(方案 docs/h5-shell-plan.md 阶段 2.A,稳定性三件套之一):
// - window "error"(capture 阶段):JS 运行时错误 + 资源元素(script/img/link...)加载失败
//   ——资源加载错误不冒泡,capture 监听才能在 window 截获,按事件 target 是否元素归类;
// - window "unhandledrejection":未捕获的 Promise rejection;
// - 三类统一规范化为 ReportPayload(kind: js_error / unhandled_rejection / resource_error)
//   走 Reporter.captureError 转发,reporter 由调用方传入;
// - 事件目标可注入(缺省 window):SSR/Node 环境(window undefined)返回 no-op 卸载函数,
//   单测注入 EventTarget 即可双环境覆盖;
// - 返回卸载函数:幂等,可重复 install/uninstall(H3.1 根布局装配用)。
// 本模块只提供函数,不自行装配(routes/layout.tsx 的接线属 H3.1)。

/** ReportPayload.kind:JS 运行时错误(window error 事件,非资源元素)。 */
export const KIND_JS_ERROR = "js_error";
/** ReportPayload.kind:未捕获 Promise rejection。 */
export const KIND_UNHANDLED_REJECTION = "unhandled_rejection";
/** ReportPayload.kind:资源元素(script/img/link 等)加载失败。 */
export const KIND_RESOURCE_ERROR = "resource_error";

/** 卸载函数:幂等,重复调用安全。 */
export type UninstallGlobalCapture = () => void;

export interface InstallGlobalCaptureOptions {
  /** 事件目标,缺省 window;Node/单测环境可注入 EventTarget。 */
  target?: EventTarget;
}

// 结构化读取(最小字段):跨 jsdom/node/浏览器 Realm 不依赖具体事件构造器 instanceof。
interface ErrorEventLike {
  message?: unknown;
  filename?: unknown;
  lineno?: unknown;
  colno?: unknown;
  error?: unknown;
}

interface ResourceTargetLike {
  tagName?: unknown;
  src?: unknown;
  href?: unknown;
}

/** 归一化 rejection reason 为人话 message(Error→"name: message",string→原样,其余 JSON 串)。 */
export function normalizeReason(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    const message = reason.message === "" ? reason.name : `${reason.name}: ${reason.message}`;
    return { message, stack: reason.stack };
  }
  if (typeof reason === "string") {
    return { message: reason };
  }
  if (reason === null || reason === undefined) {
    return { message: String(reason) };
  }
  try {
    return { message: JSON.stringify(reason) };
  } catch {
    // 循环引用等不可序列化对象:降级为可读占位,不让上报本身抛错。
    return { message: "[unserializable rejection reason]" };
  }
}

// 资源错误判定:事件 target 是带 tagName 的元素,且不是事件目标自身
// (window 自身 error 事件 target === currentTarget === window → js_error);
// DOM 事件树之外同样成立:Node EventTarget dispatch 时 target === currentTarget,
// 测试注入假元素 target(带 tagName)则走资源分支。
function isResourceErrorEvent(event: Event): boolean {
  const target = event.target as ResourceTargetLike | null | undefined;
  if (target === null || target === undefined || target === event.currentTarget) {
    return false;
  }
  return typeof target.tagName === "string";
}

// error 事件 → 载荷:target 为元素归类 resource_error,否则 js_error(ErrorEvent)。
function buildErrorPayload(event: Event): ReportPayload {
  if (isResourceErrorEvent(event)) {
    const element = event.target as ResourceTargetLike;
    const tagName = typeof element.tagName === "string" ? element.tagName : "";
    const src =
      typeof element.src === "string" && element.src !== ""
        ? element.src
        : typeof element.href === "string"
          ? element.href
          : "";
    return {
      kind: KIND_RESOURCE_ERROR,
      message: `<${tagName}> 资源加载失败: ${src}`,
      extra: { tagName, src }
    };
  }
  const errorEvent = event as ErrorEventLike;
  const error = errorEvent.error instanceof Error ? errorEvent.error : undefined;
  const message =
    typeof errorEvent.message === "string" && errorEvent.message !== ""
      ? errorEvent.message
      : normalizeReason(errorEvent.error).message;
  return {
    kind: KIND_JS_ERROR,
    message,
    stack: error?.stack,
    extra: {
      filename: typeof errorEvent.filename === "string" ? errorEvent.filename : "",
      lineno: typeof errorEvent.lineno === "number" ? errorEvent.lineno : 0,
      colno: typeof errorEvent.colno === "number" ? errorEvent.colno : 0
    }
  };
}

// unhandledrejection 事件 → 载荷:reason 归一化(normalizeReason 空值/对象/循环引用安全)。
function buildRejectionPayload(event: Event): ReportPayload {
  const reason = (event as { reason?: unknown }).reason;
  const { message, stack } = normalizeReason(reason);
  return {
    kind: KIND_UNHANDLED_REJECTION,
    message,
    stack,
    extra: { reasonType: reason === null ? "null" : typeof reason }
  };
}

/** 安装全局错误捕获(JS 错误 / 未捕获 rejection / 资源加载错误),返回幂等卸载函数。 */
export function installGlobalCapture(
  reporter: Reporter,
  options: InstallGlobalCaptureOptions = {}
): UninstallGlobalCapture {
  // 缺省 window;SSR/Node 环境无 window 且未注入目标:返回 no-op 卸载函数,装配侧无需判环境。
  const target = options.target ?? (typeof window === "undefined" ? null : window);
  if (target === null) {
    return () => undefined;
  }

  const onError = (event: Event): void => {
    reporter.captureError(buildErrorPayload(event));
  };
  const onUnhandledRejection = (event: Event): void => {
    reporter.captureError(buildRejectionPayload(event));
  };

  // error 用 capture 阶段:资源元素加载失败不冒泡,capture 监听才能在 window 截获;
  // 统一对象形式传 capture(Node EventTarget 对布尔形式 add/remove 配对存在移除失效的怪癖)。
  target.addEventListener("error", onError, { capture: true });
  target.addEventListener("unhandledrejection", onUnhandledRejection);

  let uninstalled = false;
  return () => {
    if (uninstalled) {
      return;
    }
    uninstalled = true;
    target.removeEventListener("error", onError, { capture: true });
    target.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
