import {
  createFlutterTransport,
  createJSB,
  installWindowBridge,
  resetJSB,
  setupJSB
} from "@repo/js-bridge";
import type { JSBRuntime } from "@repo/js-bridge";

export interface JSBTestHandle {
  runtime: JSBRuntime;
  dispose: () => void;
}

/**
 * 初始化调试页 JSB 单例并挂 window.__JSB_BRIDGE__;SSR(typeof window === "undefined")返回 null(纯 no-op)。
 * 重复调用幂等(setupJSB/installWindowBridge 均为覆盖语义,React StrictMode 双挂载安全)。
 */
export function initJSBTestBridge(): JSBTestHandle | null {
  if (typeof window === "undefined") {
    return null;
  }
  const runtime = setupJSB(createJSB(createFlutterTransport()));
  installWindowBridge();
  return {
    runtime,
    dispose: () => {
      delete window.__JSB_BRIDGE__;
      resetJSB();
    }
  };
}
