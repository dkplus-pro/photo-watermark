import { describe, expect, it } from "vitest";

import { isEnvelope, readErrorMessage, unwrapEnvelope } from "../src/api/envelope";

describe("isEnvelope", () => {
  it("识别 {code, message, data} 信封", () => {
    expect(isEnvelope({ code: 0, message: "ok", data: {} })).toBe(true);
  });

  it("code 为 0(零值)时仍识别为信封", () => {
    expect(isEnvelope({ code: 0, data: null })).toBe(true);
  });

  it("空值与非对象一律返回 false", () => {
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope(undefined)).toBe(false);
    expect(isEnvelope(42)).toBe(false);
    expect(isEnvelope("pong")).toBe(false);
  });

  it("缺少 data 字段返回 false", () => {
    expect(isEnvelope({ code: 0 })).toBe(false);
  });

  it("缺少 code 字段返回 false", () => {
    expect(isEnvelope({ data: {} })).toBe(false);
  });

  it("数组返回 false", () => {
    expect(isEnvelope(["pong"])).toBe(false);
  });
});

describe("unwrapEnvelope", () => {
  it("解包返回 data 载荷", () => {
    expect(
      unwrapEnvelope<{ message: string }>({
        code: 0,
        message: "ok",
        data: { message: "pong from app api" }
      })
    ).toEqual({ message: "pong from app api" });
  });

  it("非信封载荷原样返回(含 null/undefined 空值)", () => {
    expect(unwrapEnvelope("pong")).toBe("pong");
    expect(unwrapEnvelope(null)).toBe(null);
    expect(unwrapEnvelope(undefined)).toBe(undefined);
  });
});

describe("readErrorMessage", () => {
  it("优先使用服务端 message", () => {
    expect(readErrorMessage({ message: "boom" }, 500)).toBe("boom");
  });

  it("无 message 时按状态码兜底", () => {
    expect(readErrorMessage({}, 500)).toBe("请求失败(500)");
  });

  it("无响应时兜底", () => {
    expect(readErrorMessage(undefined)).toBe("请求失败(无响应)");
  });
});
