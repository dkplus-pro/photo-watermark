import { afterEach, describe, expect, it } from "vitest";

import { resetJSB } from "@repo/js-bridge";

import { initJSBTestBridge } from "../../src/routes/jsbridge-test/jsb-setup";

// 防包级单例泄漏(照 packages/js-bridge 测试纪律):每个用例后删 window 键 + 重置单例。
afterEach(() => {
  delete window.__JSB_BRIDGE__;
  resetJSB();
});

describe("initJSBTestBridge(jsdom)", () => {
  it("S2 浏览器端初始化:handle 非 null,window.__JSB_BRIDGE__ 四方法齐全", () => {
    const handle = initJSBTestBridge();
    expect(handle).not.toBeNull();
    const bridge = window.__JSB_BRIDGE__;
    expect(typeof bridge?.callNative).toBe("function");
    expect(typeof bridge?.on).toBe("function");
    expect(typeof bridge?.off).toBe("function");
    expect(typeof bridge?.dispatchEvent).toBe("function");
  });

  it("S3 幂等:重复初始化不抛,第二次 handle 可用", () => {
    expect(() => {
      initJSBTestBridge();
      initJSBTestBridge();
    }).not.toThrow();
    const second = initJSBTestBridge();
    expect(second).not.toBeNull();
    expect(typeof second?.runtime.bridge.callNative).toBe("function");
  });

  it("S4 dispose:释放后 window.__JSB_BRIDGE__ 为 undefined", () => {
    const handle = initJSBTestBridge();
    expect(window.__JSB_BRIDGE__).toBeDefined();
    handle?.dispose();
    expect(window.__JSB_BRIDGE__).toBeUndefined();
  });
});
