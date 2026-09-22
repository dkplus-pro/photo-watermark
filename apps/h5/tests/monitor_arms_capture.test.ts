// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { ReportPayload, Reporter } from "../src/core/monitor";
import {
  installGlobalCapture,
  KIND_JS_ERROR,
  KIND_RESOURCE_ERROR,
  KIND_UNHANDLED_REJECTION,
  normalizeReason
} from "../src/core/monitor/capture";

// installGlobalCapture 纯逻辑边界(node 环境,注入 EventTarget):
// 三类事件规范化为 ReportPayload 的形状、资源错误分类、卸载幂等、可重复 install。
// 真实 window 级联(jsdom)见 monitor_arms_capture_window.test.ts。

function createRecordingReporter() {
  const captureError = vi.fn();
  const captureMessage = vi.fn();
  const reporter: Reporter = { captureError, captureMessage };
  return { captureError, captureMessage, reporter };
}

function payloadOf(mock: ReturnType<typeof vi.fn>): ReportPayload {
  return mock.mock.calls[0][0] as ReportPayload;
}

describe("installGlobalCapture(js_error)", () => {
  it("error 事件规范化为 js_error 载荷(message/stack/定位字段)", () => {
    const target = new EventTarget();
    const { captureError, reporter } = createRecordingReporter();
    installGlobalCapture(reporter, { target });

    const event = new Event("error");
    Object.defineProperty(event, "message", { value: "Uncaught TypeError: boom" });
    Object.defineProperty(event, "filename", { value: "/assets/app.js" });
    Object.defineProperty(event, "lineno", { value: 12 });
    Object.defineProperty(event, "colno", { value: 34 });
    Object.defineProperty(event, "error", { value: new Error("boom") });
    target.dispatchEvent(event);

    expect(captureError).toHaveBeenCalledTimes(1);
    const payload = payloadOf(captureError);
    expect(payload.kind).toBe(KIND_JS_ERROR);
    expect(payload.message).toBe("Uncaught TypeError: boom");
    expect(payload.stack).toContain("boom");
    expect(payload.extra).toEqual({ filename: "/assets/app.js", lineno: 12, colno: 34 });
  });

  it("缺 message 字段(空值边界)回退 error 对象归一化", () => {
    const target = new EventTarget();
    const { captureError, reporter } = createRecordingReporter();
    installGlobalCapture(reporter, { target });

    const event = new Event("error");
    Object.defineProperty(event, "error", { value: new Error("fallback") });
    target.dispatchEvent(event);

    expect(payloadOf(captureError).message).toBe("Error: fallback");
  });

  it("缺 message 与 error(空值边界)回退占位文案,定位字段补 0", () => {
    const target = new EventTarget();
    const { captureError, reporter } = createRecordingReporter();
    installGlobalCapture(reporter, { target });

    target.dispatchEvent(new Event("error"));

    const payload = payloadOf(captureError);
    expect(payload.kind).toBe(KIND_JS_ERROR);
    expect(payload.message).toBe("undefined");
    expect(payload.extra).toEqual({ filename: "", lineno: 0, colno: 0 });
  });
});

describe("installGlobalCapture(resource_error)", () => {
  it("target 为元素(tagName)归类 resource_error,src 进入 message 与 extra", () => {
    const target = new EventTarget();
    const { captureError, reporter } = createRecordingReporter();
    installGlobalCapture(reporter, { target });

    const event = new Event("error");
    Object.defineProperty(event, "target", {
      value: { tagName: "IMG", src: "https://cdn.example.com/a.png" }
    });
    target.dispatchEvent(event);

    const payload = payloadOf(captureError);
    expect(payload.kind).toBe(KIND_RESOURCE_ERROR);
    expect(payload.message).toBe("<IMG> 资源加载失败: https://cdn.example.com/a.png");
    expect(payload.extra).toEqual({
      tagName: "IMG",
      src: "https://cdn.example.com/a.png"
    });
  });

  it("src 为空时回退取 href(link 样式资源)", () => {
    const target = new EventTarget();
    const { captureError, reporter } = createRecordingReporter();
    installGlobalCapture(reporter, { target });

    const event = new Event("error");
    Object.defineProperty(event, "target", {
      value: { tagName: "LINK", href: "https://cdn.example.com/a.css" }
    });
    target.dispatchEvent(event);

    expect(payloadOf(captureError).message).toBe("<LINK> 资源加载失败: https://cdn.example.com/a.css");
  });

  it("src/href 双缺(空值边界)不抛错,归一化为空串", () => {
    const target = new EventTarget();
    const { captureError, reporter } = createRecordingReporter();
    installGlobalCapture(reporter, { target });

    const event = new Event("error");
    Object.defineProperty(event, "target", { value: { tagName: "SCRIPT" } });
    expect(() => target.dispatchEvent(event)).not.toThrow();
    expect(payloadOf(captureError).extra).toEqual({ tagName: "SCRIPT", src: "" });
  });
});

describe("installGlobalCapture(unhandled_rejection)", () => {
  it.each([
    ["Error 对象", new Error("async boom"), "Error: async boom"],
    ["message 为空的 Error", new Error(""), "Error"],
    ["字符串", "oops", "oops"],
    ["空串", "", ""],
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
    ["普通对象", { code: 1 }, '{"code":1}']
  ])("reason 为%s:归一化 message 并保留类型", (_name, reason, expectedMessage) => {
    const target = new EventTarget();
    const { captureError, reporter } = createRecordingReporter();
    installGlobalCapture(reporter, { target });

    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", { value: reason });
    target.dispatchEvent(event);

    const payload = payloadOf(captureError);
    expect(payload.kind).toBe(KIND_UNHANDLED_REJECTION);
    expect(payload.message).toBe(expectedMessage);
    expect(payload.extra).toEqual({ reasonType: reason === null ? "null" : typeof reason });
  });

  it("Error reason 透传 stack", () => {
    const target = new EventTarget();
    const { captureError, reporter } = createRecordingReporter();
    installGlobalCapture(reporter, { target });

    const error = new Error("async boom");
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", { value: error });
    target.dispatchEvent(event);

    expect(payloadOf(captureError).stack).toBe(error.stack);
  });

  it("循环引用 reason 不抛错,降级占位文案", () => {
    const target = new EventTarget();
    const { captureError, reporter } = createRecordingReporter();
    installGlobalCapture(reporter, { target });

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", { value: circular });
    expect(() => target.dispatchEvent(event)).not.toThrow();
    expect(payloadOf(captureError).message).toBe("[unserializable rejection reason]");
  });
});

describe("installGlobalCapture(生命周期)", () => {
  it("卸载后不再转发;卸载幂等;可重新 install", () => {
    const target = new EventTarget();
    const first = createRecordingReporter();
    const uninstall = installGlobalCapture(first.reporter, { target });

    target.dispatchEvent(new Event("error"));
    expect(first.captureError).toHaveBeenCalledTimes(1);

    expect(() => {
      uninstall();
      uninstall();
    }).not.toThrow();
    target.dispatchEvent(new Event("error"));
    expect(first.captureError).toHaveBeenCalledTimes(1);

    const second = createRecordingReporter();
    installGlobalCapture(second.reporter, { target });
    target.dispatchEvent(new Event("error"));
    expect(second.captureError).toHaveBeenCalledTimes(1);
    expect(first.captureError).toHaveBeenCalledTimes(1);
  });

  it("Node 环境(无 window)缺省目标返回 no-op 卸载函数,不抛错", () => {
    const { captureError, reporter } = createRecordingReporter();
    const uninstall = installGlobalCapture(reporter);
    expect(() => uninstall()).not.toThrow();
    expect(captureError).not.toHaveBeenCalled();
  });
});

describe("normalizeReason(归一化)", () => {
  it("Error reason 透传 stack 与 name: message", () => {
    const error = new Error("boom");
    expect(normalizeReason(error)).toEqual({ message: "Error: boom", stack: error.stack });
  });

  it("字符串 reason 原样保留", () => {
    expect(normalizeReason("plain")).toEqual({ message: "plain" });
  });
});
