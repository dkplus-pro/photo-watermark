// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { captureRenderError, startWhiteScreenCheck } from "../src/core/stability";

// SSR 安全分支用例(node 环境,无 window):稳定性入口必须是 no-op,
// 保证服务端渲染不注册定时器、不触发监控上报(方案 §6「SSR 下监控 SDK 初始化泄漏」缓解)。

const reporterState = vi.hoisted(() => ({
  captureError: vi.fn(),
  captureMessage: vi.fn()
}));

vi.mock("../src/core/monitor", () => ({
  getReporter: () => reporterState
}));

describe("stability SSR 安全分支(node 环境)", () => {
  it("startWhiteScreenCheck 返回 no-op 取消函数,不注册定时器、不上报", () => {
    const scheduleTimer = vi.fn();
    const cancel = startWhiteScreenCheck({ scheduleTimer, timeoutMs: 100 });
    expect(typeof cancel).toBe("function");
    expect(() => cancel()).not.toThrow();
    expect(scheduleTimer).not.toHaveBeenCalled();
    expect(reporterState.captureMessage).not.toHaveBeenCalled();
  });

  it("captureRenderError 不上报(SSR 渲染错误由框架层处理)", () => {
    expect(() => captureRenderError(new Error("boom"), "    at X")).not.toThrow();
    expect(reporterState.captureError).not.toHaveBeenCalled();
  });
});
