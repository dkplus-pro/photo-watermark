/**
 * 卡 1.3:环境探测 + flutter_inappwebview transport。
 * 全文件禁止顶层访问 window(只允许函数体内、经 typeof window 守卫后访问)。
 */
import type { JSBTransport } from "./core";
import { bridgeNotAvailableError, type JSBRequest } from "./protocol";

/** native 侧注册的 handler 名,mobile 阶段 2 注册表按此名分发。 */
export const JSB_HANDLER_NAME = "jsb";

/** flutter_inappwebview 注入对象的最小结构(全部可选,探测期不做强假设)。 */
export interface FlutterInAppWebViewLike {
  callHandler?: (handlerName: string, ...args: unknown[]) => Promise<unknown>;
  postMessage?: (message: unknown) => void;
}

declare global {
  interface Window {
    flutter_inappwebview?: FlutterInAppWebViewLike;
  }
}

/** 取 flutter_inappwebview 桥;SSR(window 未定义)与桥形态非法(null/非对象)一律返回 undefined。 */
function getFlutterBridge(): FlutterInAppWebViewLike | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const candidate: unknown = window.flutter_inappwebview;
  if (candidate === null || typeof candidate !== "object") {
    return undefined;
  }
  return candidate as FlutterInAppWebViewLike;
}

/** 是否运行在 flutter_inappwebview 容器内(桥存在且具备 callHandler 或 postMessage 原语)。 */
export function isInApp(): boolean {
  const bridge = getFlutterBridge();
  if (!bridge) {
    return false;
  }
  return typeof bridge.callHandler === "function" || typeof bridge.postMessage === "function";
}

/** 创建 flutter_inappwebview transport(每次调用返回独立新对象);transport 只走 callHandler 原语。 */
export function createFlutterTransport(): JSBTransport {
  return {
    call(req: JSBRequest): Promise<unknown> {
      const bridge = getFlutterBridge();
      if (!bridge || typeof bridge.callHandler !== "function") {
        return Promise.reject(
          bridgeNotAvailableError("window.flutter_inappwebview.callHandler is not available")
        );
      }
      // req 原样引用透传,不序列化、不克隆;native promise 的 reject 原样透传(包装是 core 的职责)
      return Promise.resolve(bridge.callHandler(JSB_HANDLER_NAME, req));
    }
  };
}
