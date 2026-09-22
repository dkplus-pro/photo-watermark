import { afterEach, describe, expect, it, vi } from "vitest";

import { createJSB, normalizeJSBResponse, type JSBTransport } from "../src/core";
import { JSBError, bridgeNotAvailableError, type JSBRequest } from "../src/protocol";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const okTransport = (data: unknown): JSBTransport => ({
  call: () => Promise.resolve({ code: 0, data })
});
const pendingTransport: JSBTransport = { call: () => new Promise(() => {}) };

// 记录入参的 spy transport:应答 data 原样带回 req,保证 req 参数被合法使用
const makeCallSpy = () => vi.fn((req: JSBRequest) => Promise.resolve({ code: 0, data: req }));

const recordingTransport = () => {
  const callSpy = makeCallSpy();
  return { transport: { call: callSpy } as JSBTransport, callSpy };
};

describe("core.callNative", () => {
  it("C1 成功应答", async () => {
    const bridge = createJSB(okTransport({ version: "1.0" }));
    const data = await bridge.callNative<{ version: string }>("getDeviceInfo");
    expect(data).toEqual({ version: "1.0" });
  });

  it("C2 字符串应答归一", async () => {
    const bridge = createJSB({ call: () => Promise.resolve('{"code":0,"data":42}') });
    await expect(bridge.callNative<number>("getCount")).resolves.toBe(42);
  });

  it("C3 METHOD_NOT_FOUND 映射", async () => {
    const bridge = createJSB({
      call: () =>
        Promise.resolve({
          code: 1001,
          error: { code: "METHOD_NOT_FOUND", message: "no handler: foo" }
        })
    });
    const err = (await bridge.callNative("foo").catch((e: unknown) => e)) as JSBError;
    expect(err).toBeInstanceOf(JSBError);
    expect(err.code).toBe("METHOD_NOT_FOUND");
    expect(err.message).toBe("no handler: foo");
    expect(err.nativeCode).toBe("METHOD_NOT_FOUND");
  });

  it("C4 未知 native 码 → NATIVE_ERROR(权限缺失等价)", async () => {
    const bridge = createJSB({
      call: () =>
        Promise.resolve({ code: 5000, error: { code: "PERMISSION_DENIED", message: "deny" } })
    });
    const err = (await bridge.callNative("takePhoto").catch((e: unknown) => e)) as JSBError;
    expect(err).toBeInstanceOf(JSBError);
    expect(err.code).toBe("NATIVE_ERROR");
    expect(err.nativeCode).toBe("PERMISSION_DENIED");
    expect(err.message).toBe("deny");
  });

  it("C5 native 失败但缺 error 字段 → 兜底文案(空值)", async () => {
    const bridge = createJSB({ call: () => Promise.resolve({ code: 7 }) });
    const err = (await bridge.callNative("getDeviceInfo").catch((e: unknown) => e)) as JSBError;
    expect(err).toBeInstanceOf(JSBError);
    expect(err.code).toBe("NATIVE_ERROR");
    expect(err.nativeCode).toBe(7);
    expect(err.message).toContain("7");
    expect(err.message).toContain("getDeviceInfo");
  });

  it("C6 应答 null → BAD_RESPONSE(空值)", async () => {
    const bridge = createJSB({ call: () => Promise.resolve(null) });
    await expect(bridge.callNative("m")).rejects.toMatchObject({
      name: "JSBError",
      code: "BAD_RESPONSE"
    });
  });

  it("C7 非 JSON 字符串 → BAD_RESPONSE", async () => {
    const bridge = createJSB({ call: () => Promise.resolve("not-json") });
    await expect(bridge.callNative("m")).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("C8 code 非数字 → BAD_RESPONSE(越界)", async () => {
    const bridge = createJSB({ call: () => Promise.resolve('{"code":"0"}') });
    await expect(bridge.callNative("m")).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("C9 数组/数字应答 → BAD_RESPONSE(越界)", async () => {
    const arrayBridge = createJSB({ call: () => Promise.resolve([]) });
    await expect(arrayBridge.callNative("m")).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    const numberBridge = createJSB({ call: () => Promise.resolve(42) });
    await expect(numberBridge.callNative("m")).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("C10 transport reject 普通 Error → NATIVE_ERROR 包装(网络失败)", async () => {
    const bridge = createJSB({ call: () => Promise.reject(new Error("boom")) });
    const err = (await bridge.callNative("m").catch((e: unknown) => e)) as JSBError;
    expect(err).toBeInstanceOf(JSBError);
    expect(err.code).toBe("NATIVE_ERROR");
    expect(err.message).toContain("boom");
    expect(err.nativeCode).toBeUndefined();
  });

  it("C11 transport reject JSBError 原样透传(同一引用)", async () => {
    const injected = bridgeNotAvailableError();
    const bridge = createJSB({ call: () => Promise.reject(injected) });
    const err = await bridge.callNative("m").catch((e: unknown) => e);
    expect(err).toBe(injected);
  });

  it("C12 transport 同步 throw → 转 reject,不得同步抛(非法状态)", async () => {
    const bridge = createJSB({
      call: () => {
        throw new Error("sync");
      }
    });
    // 同步不抛;返回的 promise 必须在同一同步块内立即挂 handler,防 unhandled rejection
    const captured: Array<Promise<unknown>> = [];
    expect(() => captured.push(bridge.callNative("m"))).not.toThrow();
    captured.push(bridge.callNative("m"));
    const results = await Promise.all(captured.map((p) => p.catch((e: unknown) => e as JSBError)));
    expect(results[0]).toBeInstanceOf(JSBError);
    expect(results[1]).toBeInstanceOf(JSBError);
    expect((results[0] as JSBError).code).toBe("NATIVE_ERROR");
    expect((results[0] as JSBError).message).toContain("sync");
  });

  it("C13 默认 30s 超时(网络失败)", async () => {
    vi.useFakeTimers();
    const bridge = createJSB(pendingTransport);
    // 先挂 rejection handler 再 advance,防 unhandled rejection
    const promise = bridge.callNative("getDeviceInfo").catch((e: unknown) => e as JSBError);
    await vi.advanceTimersByTimeAsync(30000);
    const err = (await promise) as JSBError;
    expect(err.name).toBe("JSBError");
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toContain("getDeviceInfo");
    expect(err.message).toContain("30000");
    vi.useRealTimers();
  });

  it("C14 单调用超时覆盖", async () => {
    vi.useFakeTimers();
    const bridge = createJSB(pendingTransport);
    const onSettle = vi.fn();
    bridge.callNative("m", undefined, { timeoutMs: 5000 }).then(onSettle, onSettle);
    await vi.advanceTimersByTimeAsync(4999);
    expect(onSettle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onSettle).toHaveBeenCalledTimes(1);
    const settled = onSettle.mock.calls[0]?.[0] as JSBError;
    expect(settled.code).toBe("TIMEOUT");
    vi.useRealTimers();
  });

  it("C15 timeoutMs 0 = 不超时(零值)", async () => {
    vi.useFakeTimers();
    const bridge = createJSB(pendingTransport);
    const onSettle = vi.fn();
    bridge.callNative("m", undefined, { timeoutMs: 0 }).then(onSettle, onSettle);
    await vi.advanceTimersByTimeAsync(600000);
    expect(onSettle).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("C15b timeoutMs 0 且 transport 正常应答 → 正常 resolve(零值)", async () => {
    vi.useFakeTimers();
    const bridge = createJSB(okTransport(7));
    await expect(bridge.callNative("m", undefined, { timeoutMs: 0 })).resolves.toBe(7);
    vi.useRealTimers();
  });

  it("C16 超时后迟到应答被忽略(非法状态迁移)", async () => {
    vi.useFakeTimers();
    let resolveCall!: (value: unknown) => void;
    const holder: JSBTransport = {
      call: () =>
        new Promise((resolve) => {
          resolveCall = resolve;
        })
    };
    const bridge = createJSB(holder);
    const promise = bridge.callNative("m");
    const assertion = expect(promise).rejects.toMatchObject({ name: "JSBError", code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
    // 迟到的成功应答:settle-once 生效,结果仍是 TIMEOUT
    resolveCall({ code: 0, data: 1 });
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).rejects.toMatchObject({ name: "JSBError", code: "TIMEOUT" });
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("C17 成功应答清理计时器", async () => {
    vi.useFakeTimers();
    const bridge = createJSB(okTransport(1));
    const assertion = expect(bridge.callNative("m")).resolves.toBe(1);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("C18 入参非法 → BAD_PARAMS 且 transport 不被调用(空值/越界)", async () => {
    const { transport, callSpy } = recordingTransport();
    const bridge = createJSB(transport);
    await expect(bridge.callNative("")).rejects.toMatchObject({ code: "BAD_PARAMS" });
    await expect(bridge.callNative("   ")).rejects.toMatchObject({ code: "BAD_PARAMS" });
    await expect(bridge.callNative("m", undefined, { timeoutMs: -1 })).rejects.toMatchObject({
      code: "BAD_PARAMS"
    });
    expect(callSpy).not.toHaveBeenCalled();
  });

  it("C19 请求信封组装(空值)", async () => {
    const callSpy = makeCallSpy();
    const bridge = createJSB({ call: callSpy }, { idFactory: () => "id-1" });
    await bridge.callNative("getDeviceInfo", { a: 1 });
    expect(callSpy).toHaveBeenCalledWith({ id: "id-1", method: "getDeviceInfo", params: { a: 1 } });
    await bridge.callNative("ping");
    const secondReq = callSpy.mock.calls[1]?.[0] as JSBRequest;
    expect("params" in secondReq).toBe(false);
  });

  it("C20 注入 idFactory", async () => {
    const callSpy = makeCallSpy();
    const bridge = createJSB({ call: callSpy }, { idFactory: () => "fixed-id" });
    await bridge.callNative("m");
    expect(callSpy.mock.calls[0]?.[0]).toMatchObject({ id: "fixed-id" });
  });

  it("C21 默认 id 形态与注入 now(seq 自 1、实例独立)", async () => {
    const first = recordingTransport();
    const bridge = createJSB(first.transport, { now: () => 1000 });
    await bridge.callNative("m1");
    await bridge.callNative("m2");
    expect(first.callSpy.mock.calls[0]?.[0]?.id).toBe("jsb_1000_1");
    expect(first.callSpy.mock.calls[1]?.[0]?.id).toBe("jsb_1000_2");
    // 实例独立:第二个实例的 seq 从 1 重新计数
    const second = recordingTransport();
    const bridge2 = createJSB(second.transport, { now: () => 1000 });
    await bridge2.callNative("m");
    expect(second.callSpy.mock.calls[0]?.[0]?.id).toBe("jsb_1000_1");
  });

  it("C22 createJSB 入参非法 → 同步 TypeError(非法状态)", () => {
    expect(() => createJSB(undefined as never)).toThrow(TypeError);
    expect(() => createJSB({} as never)).toThrow(TypeError);
  });

  it("C23 code 0 无 data → resolve undefined(零值)", async () => {
    const bridge = createJSB({ call: () => Promise.resolve({ code: 0 }) });
    await expect(bridge.callNative("m")).resolves.toBeUndefined();
  });
});

describe("core.normalizeJSBResponse", () => {
  it("C24 对象直进直出 + error 畸形整形", () => {
    // 对象直进直出
    expect(normalizeJSBResponse({ code: 0, data: 1 })).toEqual({ code: 0, data: 1 });
    // 成功侧 error 畸形(非对象)→ 忽略,不影响成功
    const ok = normalizeJSBResponse({ code: 0, error: "x" });
    expect(ok.code).toBe(0);
    expect(ok.error).toBeUndefined();
    // 失败侧 error 畸形(code 非 string)→ error 视为 undefined,由映射层兜底
    const bad = normalizeJSBResponse({ code: 1, error: { code: 1 } });
    expect(bad.code).toBe(1);
    expect(bad.error).toBeUndefined();
  });
});
