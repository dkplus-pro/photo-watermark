import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CALL_TIMEOUT_MS,
  JSBError,
  JSB_ERROR_CODES,
  JSB_HANDLER_NAME,
  WINDOW_BRIDGE_KEY,
  badResponseError,
  bridgeNotAvailableError,
  callNative,
  createFlutterTransport,
  createJSB,
  createJSBError,
  createJSBEvents,
  getJSB,
  installWindowBridge,
  isInApp,
  isJSBError,
  normalizeJSBResponse,
  off,
  on,
  resetJSB,
  setupJSB,
  timeoutError,
  type JSBBridge
} from "../src/index";

function stubWindow(value: Record<string, unknown> | undefined): void {
  const g = globalThis as Record<string, unknown>;
  if (value === undefined) {
    delete g["window"];
  } else {
    g["window"] = value;
  }
}

// 泛型方法形态的假桥(与 JSBBridge 的泛型签名同构,可直接通过 assignability)
const fakeBridge: JSBBridge = {
  async callNative<T = unknown>(): Promise<T> {
    return undefined as T;
  }
};

afterEach(() => {
  resetJSB();
  stubWindow(undefined);
});

describe("index 公共出口", () => {
  it("I1 re-export 冒烟(§5.6 全清单)", () => {
    // 函数/class 全清单
    const functionExports = [
      createJSB,
      normalizeJSBResponse,
      createJSBEvents,
      createFlutterTransport,
      isInApp,
      setupJSB,
      getJSB,
      resetJSB,
      installWindowBridge,
      callNative,
      on,
      off,
      JSBError,
      createJSBError,
      isJSBError,
      bridgeNotAvailableError,
      timeoutError,
      badResponseError
    ];
    for (const item of functionExports) {
      expect(typeof item).toBe("function");
    }
    // 常量
    expect(Array.isArray(JSB_ERROR_CODES)).toBe(true);
    expect(DEFAULT_CALL_TIMEOUT_MS).toBe(30000);
    expect(WINDOW_BRIDGE_KEY).toBe("__JSB_BRIDGE__");
    expect(JSB_HANDLER_NAME).toBe("jsb");
  });

  it("I2 callNative 代理", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown>; opts?: unknown }> = [];
    setupJSB({
      async callNative<T = unknown>(
        method: string,
        params?: Record<string, unknown>,
        opts?: unknown
      ): Promise<T> {
        calls.push({ method, params, opts });
        return undefined as T;
      }
    });
    await expect(callNative("m", { a: 1 })).resolves.toBeUndefined();
    expect(calls).toEqual([{ method: "m", params: { a: 1 }, opts: undefined }]);
  });

  it("I3 on/off 代理", () => {
    setupJSB(fakeBridge);
    let received: unknown;
    const handler = (p: unknown): void => {
      received = p;
    };
    const unsubscribe = on("e", handler);
    getJSB().events.dispatch("e", 1);
    expect(received).toBe(1);
    off("e", handler);
    getJSB().events.dispatch("e", 2);
    expect(received).toBe(1);
    unsubscribe();
  });

  it("I4 callNative 未 setup → 同步抛 JSBError", () => {
    // afterEach 已 resetJSB,单例处于未 setup 状态;
    // callNative 是普通函数,getJSB() 的同步 throw 直接冒泡为同步抛,不得包成 reject
    expect(() => callNative("m")).toThrow(JSBError);
  });
});
