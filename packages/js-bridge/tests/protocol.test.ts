import { describe, expect, it } from "vitest";

import {
  DEFAULT_CALL_TIMEOUT_MS,
  JSB_ERROR_CODES,
  JSB_RESULT_OK,
  JSBError,
  badResponseError,
  bridgeNotAvailableError,
  createJSBError,
  isJSBError,
  timeoutError
} from "../src/protocol";

describe("protocol", () => {
  it("P1 常量值", () => {
    expect(JSB_RESULT_OK).toBe(0);
    expect(DEFAULT_CALL_TIMEOUT_MS).toBe(30000);
    expect(JSB_ERROR_CODES).toHaveLength(7);
    expect([...JSB_ERROR_CODES]).toEqual([
      "BRIDGE_NOT_AVAILABLE",
      "TIMEOUT",
      "METHOD_NOT_FOUND",
      "BAD_PARAMS",
      "BAD_RESPONSE",
      "NATIVE_ERROR",
      "CANCELLED"
    ]);
  });

  it("P2 createJSBError 整形", () => {
    const err = createJSBError("TIMEOUT", "boom", "NATIVE-42");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(JSBError);
    expect(err.name).toBe("JSBError");
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toBe("boom");
    expect(err.nativeCode).toBe("NATIVE-42");
    // 不传 nativeCode 时保持 undefined(不是 null/"")
    const noNativeCode = createJSBError("BAD_PARAMS", "x");
    expect(noNativeCode.nativeCode).toBeUndefined();
  });

  it("P3 isJSBError 甄别(空值)", () => {
    expect(isJSBError(createJSBError("TIMEOUT", "x"))).toBe(true);
    expect(isJSBError(new Error("plain"))).toBe(false);
    expect(isJSBError(null)).toBe(false);
    expect(isJSBError(undefined)).toBe(false);
    expect(isJSBError({ code: "TIMEOUT" })).toBe(false);
    expect(isJSBError("TIMEOUT")).toBe(false);
  });

  it("P4 工厂消息", () => {
    // bridgeNotAvailableError 无参 → 默认 message 且 code 正确
    const notAvailable = bridgeNotAvailableError();
    expect(notAvailable.code).toBe("BRIDGE_NOT_AVAILABLE");
    expect(notAvailable.message).toBe(
      "JSB bridge is not available (not running inside flutter_inappwebview)"
    );
    // timeoutError 消息含 method 与时长
    const timeout = timeoutError("getDeviceInfo", 5000);
    expect(timeout.code).toBe("TIMEOUT");
    expect(timeout.message).toContain("getDeviceInfo");
    expect(timeout.message).toContain("5000");
    // badResponseError 消息含 detail
    const badResponse = badResponseError("x");
    expect(badResponse.code).toBe("BAD_RESPONSE");
    expect(badResponse.message).toContain("x");
  });
});
