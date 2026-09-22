// 全局错误钩子规范化:app.tsx(阶段 N3)经 Taro 的 useError/useUnhandledRejection/
// usePageNotFound 拿到原始入参后,一行交给你 createGlobalHooks 的同名 handler 规范化
// 并转发 monitor。规范化永不抛错:未知形状回退占位文案(空值边界)。
import type { MonitorPayload } from "./index";

/** wx onError 入参:字符串错误(可能带堆栈文本)。 */
export function normalizeJsError(errorMessage: unknown): MonitorPayload {
  const message =
    typeof errorMessage === "string" && errorMessage.trim() !== ""
      ? errorMessage
      : "[unknown js error]";
  const [head, ...rest] = message.split("\n");
  return {
    kind: "js_error",
    message: head,
    stack: rest.length > 0 ? message : undefined,
    extra: {}
  };
}

/** onUnhandledRejection 入参子集(reason 形状不定)。 */
export interface UnhandledRejectionLike {
  reason?: unknown;
  message?: string;
}

/** 未捕获 Promise rejection:reason 归一化(Error→name: message,字符串→原样,其余 JSON 串)。 */
export function normalizeUnhandledRejection(rejection: UnhandledRejectionLike | undefined): MonitorPayload {
  const reason = rejection?.reason;
  if (reason instanceof Error) {
    return {
      kind: "unhandled_rejection",
      message: reason.message === "" ? reason.name : `${reason.name}: ${reason.message}`,
      stack: reason.stack,
      extra: {}
    };
  }
  if (typeof reason === "string" && reason !== "") {
    return { kind: "unhandled_rejection", message: reason, extra: {} };
  }
  if (reason === null || reason === undefined) {
    const fallback = typeof rejection?.message === "string" && rejection.message !== "" ? rejection.message : "[unhandled rejection]";
    return { kind: "unhandled_rejection", message: fallback, extra: {} };
  }
  try {
    return { kind: "unhandled_rejection", message: JSON.stringify(reason), extra: {} };
  } catch {
    return { kind: "unhandled_rejection", message: "[unserializable rejection reason]", extra: {} };
  }
}

/** onPageNotFound 入参子集。 */
export interface PageNotFoundLike {
  path?: string;
  query?: Record<string, string>;
}

/** 页面不存在:路径 + query 透传,缺失回退占位。 */
export function normalizePageNotFound(notFound: PageNotFoundLike | undefined): MonitorPayload {
  const path = typeof notFound?.path === "string" && notFound.path !== "" ? notFound.path : "[unknown path]";
  return {
    kind: "page_not_found",
    message: `页面不存在: ${path}`,
    extra: { path, query: notFound?.query ?? {} }
  };
}

/** client.ts 请求链错误入参(api_error):状态码/errMsg/端点语义由调用方拼好传入。 */
export function normalizeApiError(input: { endpoint?: string; errMsg?: string; code?: number }): MonitorPayload {
  const endpoint = typeof input.endpoint === "string" && input.endpoint !== "" ? input.endpoint : "[unknown endpoint]";
  const detail = typeof input.errMsg === "string" && input.errMsg !== "" ? input.errMsg : "request failed";
  return {
    kind: "api_error",
    message: `请求失败: ${endpoint} (${detail})`,
    extra: { endpoint, code: typeof input.code === "number" ? input.code : 0 }
  };
}
