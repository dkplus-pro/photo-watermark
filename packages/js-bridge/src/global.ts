/**
 * 卡 1.3:包级单例 + window 挂载(供 native evaluateJavascript 注入与调试)。
 */
import type { JSBBridge } from "./core";
import { createJSBEvents, type JSBEventBus } from "./events";
import { createJSBError } from "./protocol";

export interface JSBRuntime {
  bridge: JSBBridge;
  events: JSBEventBus;
}

/** 挂到 window 上的调试/注入面;dispatchEvent 是 native evaluateJavascript 的注入入口。 */
export interface WindowJSBBridge {
  callNative: JSBBridge["callNative"];
  on: JSBEventBus["on"];
  off: JSBEventBus["off"];
  dispatchEvent: (event: string, payload?: unknown) => void;
}

export const WINDOW_BRIDGE_KEY = "__JSB_BRIDGE__";

declare global {
  interface Window {
    __JSB_BRIDGE__?: WindowJSBBridge;
  }
}

let current: JSBRuntime | undefined;

/**
 * 装配包级单例;events 省略时自动创建。重复调用直接覆盖(幂等装配,h5 热更新场景安全)。
 */
export function setupJSB(bridge: JSBBridge, events: JSBEventBus = createJSBEvents()): JSBRuntime {
  if (!bridge || typeof bridge.callNative !== "function") {
    throw new TypeError("setupJSB requires a bridge exposing a callNative() function");
  }
  current = { bridge, events };
  return current;
}

/** 取包级单例;未 setup 时同步抛 JSBError(BRIDGE_NOT_AVAILABLE)。 */
export function getJSB(): JSBRuntime {
  if (!current) {
    throw createJSBError("BRIDGE_NOT_AVAILABLE", "setupJSB() has not been called");
  }
  return current;
}

/** 测试专用:清空单例。afterEach 调用。 */
export function resetJSB(): void {
  current = undefined;
}

/**
 * 把单例的四个便捷方法挂到 window.__JSB_BRIDGE__(重复 install 覆盖旧对象)。
 * SSR(window 未定义)为 no-op 返回 undefined;未 setup 时抛 JSBError。
 */
export function installWindowBridge(): WindowJSBBridge | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const runtime = getJSB();
  const api: WindowJSBBridge = {
    callNative: (method, params, opts) => runtime.bridge.callNative(method, params, opts),
    on: (event, handler) => runtime.events.on(event, handler),
    off: (event, handler) => runtime.events.off(event, handler),
    // native evaluateJavascript 注入事件入口:window.__JSB_BRIDGE__.dispatchEvent("event", payload)
    dispatchEvent: (event, payload) => runtime.events.dispatch(event, payload)
  };
  window.__JSB_BRIDGE__ = api;
  return api;
}
