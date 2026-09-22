import { afterEach, describe, expect, it, vi } from "vitest";

import { JSB_HANDLER_NAME, createFlutterTransport, isInApp } from "../src/adapter";
import { type JSBRequest } from "../src/protocol";

// node 环境无 window,经 globalThis stub 注入(照抄 apps/miniapp/tests 先例),每个用例结束还原
function stubWindow(value: Record<string, unknown> | undefined): void {
  const g = globalThis as Record<string, unknown>;
  if (value === undefined) {
    delete g["window"];
  } else {
    g["window"] = value;
  }
}

afterEach(() => {
  stubWindow(undefined);
  vi.restoreAllMocks();
});

const req: JSBRequest = { id: "t-1", method: "getDeviceInfo" };

describe("adapter.isInApp", () => {
  it("A1 无 window(SSR)→ false 且不抛(空值)", () => {
    expect(() => isInApp()).not.toThrow();
    expect(isInApp()).toBe(false);
  });

  it("A2 空 window → false(空值)", () => {
    stubWindow({});
    expect(isInApp()).toBe(false);
  });

  it("A3 桥为空对象 → false(空值)", () => {
    stubWindow({ flutter_inappwebview: {} });
    expect(isInApp()).toBe(false);
  });

  it("A4 仅 postMessage → true", () => {
    stubWindow({ flutter_inappwebview: { postMessage: () => {} } });
    expect(isInApp()).toBe(true);
  });

  it("A5 仅 callHandler → true", () => {
    stubWindow({ flutter_inappwebview: { callHandler: async () => 1 } });
    expect(isInApp()).toBe(true);
  });

  it("A6 桥为 null/非对象 → false 且不抛(空值)", () => {
    stubWindow({ flutter_inappwebview: null });
    expect(isInApp()).toBe(false);
    stubWindow({ flutter_inappwebview: 1 });
    expect(isInApp()).toBe(false);
  });
});

describe("adapter.createFlutterTransport", () => {
  it("A7 无 window → BRIDGE_NOT_AVAILABLE(SSR,网络失败)", async () => {
    const transport = createFlutterTransport();
    await expect(transport.call(req)).rejects.toMatchObject({
      name: "JSBError",
      code: "BRIDGE_NOT_AVAILABLE"
    });
  });

  it("A8 桥无 callHandler(仅 postMessage)→ reject(非法状态)", async () => {
    stubWindow({ flutter_inappwebview: { postMessage: () => {} } });
    const transport = createFlutterTransport();
    await expect(transport.call(req)).rejects.toMatchObject({ code: "BRIDGE_NOT_AVAILABLE" });
  });

  it("A9 正常往返 + 序列化(req 原样引用透传)", async () => {
    const callHandler = vi.fn(async (name: string, r: unknown) => ({ code: 0, data: r }));
    stubWindow({ flutter_inappwebview: { callHandler } });
    const transport = createFlutterTransport();
    const payload: JSBRequest = { id: "t-1", method: "getDeviceInfo", params: { n: 1 } };
    const result = (await transport.call(payload)) as { code: number; data: unknown };
    // handler 名为 "jsb"
    expect(callHandler.mock.calls[0]?.[0]).toBe("jsb");
    // req 与传入对象同一引用(不序列化、不克隆)
    expect(result.data).toBe(payload);
    // 序列化往返不丢字段
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it("A10 native promise reject 透传,adapter 不包装(网络失败)", async () => {
    const nativeError = new Error("native boom");
    stubWindow({ flutter_inappwebview: { callHandler: () => Promise.reject(nativeError) } });
    const transport = createFlutterTransport();
    const err = await transport.call(req).catch((e: unknown) => e);
    expect(err).toBe(nativeError);
  });

  it("A11 JSB_HANDLER_NAME 常量", () => {
    expect(JSB_HANDLER_NAME).toBe("jsb");
  });
});
