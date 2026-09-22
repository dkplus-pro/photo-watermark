import { afterEach, describe, expect, it } from "vitest";

import type { JSBBridge } from "../src/core";
import { createJSBEvents } from "../src/events";
import { WINDOW_BRIDGE_KEY, getJSB, installWindowBridge, resetJSB, setupJSB } from "../src/global";
import { JSBError } from "../src/protocol";

// node 环境无 window,经 globalThis stub 注入,每个用例结束必须还原(防污染 SSR 分支)
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

describe("global 单例", () => {
  it("G1 getJSB 未 setup → 同步抛 JSBError(非法状态)", () => {
    let caught: unknown;
    try {
      getJSB();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(JSBError);
    expect((caught as JSBError).code).toBe("BRIDGE_NOT_AVAILABLE");
    expect((caught as JSBError).message).toContain("setupJSB() has not been called");
  });

  it("G2 setupJSB 自动建 events;显式传 events 用同一引用", () => {
    const runtime = setupJSB(fakeBridge);
    expect(runtime.bridge).toBe(fakeBridge);
    expect(runtime.events).toBeDefined();
    const got = getJSB();
    expect(got.bridge).toBe(fakeBridge);
    expect(got.events).toBeDefined();
    // 显式传 events → 同一引用
    const events = createJSBEvents();
    const runtime2 = setupJSB(fakeBridge, events);
    expect(runtime2.events).toBe(events);
    expect(getJSB().events).toBe(events);
  });

  it("G3 setupJSB 非法入参 → TypeError(非法状态)", () => {
    expect(() => setupJSB(undefined as never)).toThrow(TypeError);
    expect(() => setupJSB({} as never)).toThrow(TypeError);
  });
});

describe("global installWindowBridge", () => {
  it("G4 无 window → SSR no-op 返回 undefined(空值)", () => {
    setupJSB(fakeBridge);
    expect(installWindowBridge()).toBeUndefined();
  });

  it("G5 未 setup → 抛 JSBError(非法状态)", () => {
    stubWindow({});
    expect(() => installWindowBridge()).toThrow(JSBError);
  });

  it("G6 挂载与代理链路", async () => {
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
    stubWindow({});
    const api = installWindowBridge();
    if (!api) {
      throw new Error("installWindowBridge should return api when window exists");
    }
    // window.__JSB_BRIDGE__ 与返回值同一引用,四方法齐全
    expect((globalThis as Record<string, unknown>)["window"]).toMatchObject({
      [WINDOW_BRIDGE_KEY]: api
    });
    expect(typeof api.callNative).toBe("function");
    expect(typeof api.on).toBe("function");
    expect(typeof api.off).toBe("function");
    expect(typeof api.dispatchEvent).toBe("function");
    // callNative 代理透传
    await api.callNative("m", { a: 1 });
    expect(calls).toEqual([{ method: "m", params: { a: 1 }, opts: undefined }]);
    // on/dispatchEvent/off 链路
    let received: unknown;
    const handler = (p: unknown): void => {
      received = p;
    };
    api.on("e", handler);
    api.dispatchEvent("e", { x: 1 });
    expect(received).toEqual({ x: 1 });
    api.off("e", handler);
    api.dispatchEvent("e", { x: 2 });
    expect(received).toEqual({ x: 1 });
  });

  it("G7 重复 install 覆盖(非法状态迁移)", () => {
    setupJSB(fakeBridge);
    stubWindow({});
    const first = installWindowBridge();
    const second = installWindowBridge();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(window.__JSB_BRIDGE__).toBe(second);
    expect(window.__JSB_BRIDGE__).not.toBe(first);
  });

  it("G8 WINDOW_BRIDGE_KEY 常量", () => {
    expect(WINDOW_BRIDGE_KEY).toBe("__JSB_BRIDGE__");
  });
});
