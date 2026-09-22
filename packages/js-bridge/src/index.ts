/**
 * 卡 1.3:@repo/js-bridge 唯一公共出口——re-export 全部协议/核心/事件/适配/单例 API
 * + callNative/on/off 单例便捷代理。src 内部模块禁止经本文件中转(依赖方向见施工方案 §3)。
 */
export {
  DEFAULT_CALL_TIMEOUT_MS,
  JSB_RESULT_OK,
  JSB_ERROR_CODES,
  JSBError,
  badResponseError,
  bridgeNotAvailableError,
  createJSBError,
  isJSBError,
  timeoutError
} from "./protocol";
export type { JSBErrorCode, JSBRequest, JSBResponse, JSBResult, JSBResultError } from "./protocol";

export { createJSB, normalizeJSBResponse } from "./core";
export type { CallNativeOptions, JSBBridge, JSBOptions, JSBTransport } from "./core";

export { createJSBEvents } from "./events";
export type { JSBEventBus, JSBEventHandler } from "./events";

export { JSB_HANDLER_NAME, createFlutterTransport, isInApp } from "./adapter";
export type { FlutterInAppWebViewLike } from "./adapter";

export { WINDOW_BRIDGE_KEY, getJSB, installWindowBridge, resetJSB, setupJSB } from "./global";
export type { JSBRuntime, WindowJSBBridge } from "./global";

import type { CallNativeOptions } from "./core";
import type { JSBEventHandler } from "./events";
import { getJSB } from "./global";

/** 单例便捷代理:等价于 getJSB().bridge.callNative(...)。 */
export function callNative<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  opts?: CallNativeOptions
): Promise<T> {
  return getJSB().bridge.callNative<T>(method, params, opts);
}

/** 单例便捷代理:等价于 getJSB().events.on(...)。 */
export function on(event: string, handler: JSBEventHandler): () => void {
  return getJSB().events.on(event, handler);
}

/** 单例便捷代理:等价于 getJSB().events.off(...)。 */
export function off(event: string, handler: JSBEventHandler): void {
  getJSB().events.off(event, handler);
}
