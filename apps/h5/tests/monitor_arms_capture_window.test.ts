// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReportPayload, Reporter } from "../src/core/monitor";
import {
  installGlobalCapture,
  KIND_JS_ERROR,
  KIND_RESOURCE_ERROR,
  KIND_UNHANDLED_REJECTION
} from "../src/core/monitor/capture";

// installGlobalCapture 真实 window 级联(jsdom):缺省目标 = window、capture 阶段截获
// 资源元素加载错误、ErrorEvent/PromiseRejection 真实事件形状。Node 侧纯逻辑见
// monitor_arms_capture.test.ts。

function createRecordingReporter() {
  const captureError = vi.fn();
  const captureMessage = vi.fn();
  const reporter: Reporter = { captureError, captureMessage };
  return { captureError, captureMessage, reporter };
}

function payloadOf(mock: ReturnType<typeof vi.fn>): ReportPayload {
  return mock.mock.calls[0][0] as ReportPayload;
}

describe("installGlobalCapture(window 级联)", () => {
  const uninstalls: Array<() => void> = [];

  afterEach(() => {
    while (uninstalls.length > 0) {
      uninstalls.pop()?.();
    }
    document.body.innerHTML = "";
  });

  it("window error 事件(ErrorEvent)转发 js_error 载荷", () => {
    const { captureError, reporter } = createRecordingReporter();
    uninstalls.push(installGlobalCapture(reporter));

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "Uncaught TypeError: boom",
        filename: "/assets/app.js",
        lineno: 12,
        colno: 34,
        error: new Error("boom")
      })
    );

    expect(captureError).toHaveBeenCalledTimes(1);
    const payload = payloadOf(captureError);
    expect(payload.kind).toBe(KIND_JS_ERROR);
    expect(payload.message).toBe("Uncaught TypeError: boom");
    expect(payload.stack).toContain("boom");
    expect(payload.extra).toEqual({ filename: "/assets/app.js", lineno: 12, colno: 34 });
  });

  it("img 加载错误经 capture 阶段到达 window,归类 resource_error", () => {
    const { captureError, reporter } = createRecordingReporter();
    uninstalls.push(installGlobalCapture(reporter));

    const img = document.createElement("img");
    img.setAttribute("src", "https://cdn.example.com/a.png");
    document.body.appendChild(img);
    img.dispatchEvent(new Event("error"));

    expect(captureError).toHaveBeenCalledTimes(1);
    const payload = payloadOf(captureError);
    expect(payload.kind).toBe(KIND_RESOURCE_ERROR);
    expect(payload.message).toBe("<IMG> 资源加载失败: https://cdn.example.com/a.png");
    expect(payload.extra).toEqual({ tagName: "IMG", src: "https://cdn.example.com/a.png" });
  });

  it("script 加载错误同样归类 resource_error", () => {
    const { captureError, reporter } = createRecordingReporter();
    uninstalls.push(installGlobalCapture(reporter));

    const script = document.createElement("script");
    script.setAttribute("src", "https://cdn.example.com/a.js");
    document.body.appendChild(script);
    script.dispatchEvent(new Event("error"));

    const payload = payloadOf(captureError);
    expect(payload.kind).toBe(KIND_RESOURCE_ERROR);
    expect(payload.extra).toEqual({
      tagName: "SCRIPT",
      src: "https://cdn.example.com/a.js"
    });
  });

  it("unhandledrejection 事件转发 unhandled_rejection 载荷", () => {
    const { captureError, reporter } = createRecordingReporter();
    uninstalls.push(installGlobalCapture(reporter));

    const error = new Error("async boom");
    const event = new Event("unhandledrejection") as Event & { reason?: unknown };
    Object.defineProperty(event, "reason", { value: error });
    window.dispatchEvent(event);

    expect(captureError).toHaveBeenCalledTimes(1);
    const payload = payloadOf(captureError);
    expect(payload.kind).toBe(KIND_UNHANDLED_REJECTION);
    expect(payload.message).toBe("Error: async boom");
    expect(payload.stack).toBe(error.stack);
  });

  it("卸载后 window 级事件不再转发,卸载幂等", () => {
    const { captureError, reporter } = createRecordingReporter();
    const uninstall = installGlobalCapture(reporter);

    window.dispatchEvent(new Event("error"));
    expect(captureError).toHaveBeenCalledTimes(1);

    expect(() => {
      uninstall();
      uninstall();
    }).not.toThrow();
    window.dispatchEvent(new Event("error"));
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
