// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureRenderError, ErrorBoundary } from "../src/core/stability";

// ErrorBoundary 组件用例(jsdom + testing-library,照 admin 组件用例范式):
// 三态 = 正常渲染 / 捕获降级 / 重试恢复,另覆盖重复上报与自定义 fallback。
// 上报断言经 vi.mock monitor 接口注入 fake reporter;
// 纪律:core 组件用例零组件依赖(不引 arco-mobile,内置降级 UI 为原生标签)。

const reporterState = vi.hoisted(() => ({
  captureError: vi.fn(),
  captureMessage: vi.fn()
}));

vi.mock("../src/core/monitor", () => ({
  getReporter: () => reporterState
}));

// 炸弹子组件:shouldThrow 控制渲染期抛错(重试用例里置回 false 验证恢复)。
const bombState = { shouldThrow: false };

function Bomb() {
  if (bombState.shouldThrow) {
    throw new Error("boom");
  }
  return <div>页面内容</div>;
}

function renderWithBoundary(key?: string) {
  return render(
    <ErrorBoundary>
      <Bomb key={key} />
    </ErrorBoundary>
  );
}

describe("ErrorBoundary(渲染错误边界)", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    bombState.shouldThrow = false;
    reporterState.captureError.mockClear();
    reporterState.captureMessage.mockClear();
    // React 在捕获错误时会经 console.error 打开发提示,测试里静音降噪。
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    cleanup();
  });

  it("正常渲染:子树透出,不上报", () => {
    renderWithBoundary();
    expect(screen.getByText("页面内容")).toBeInTheDocument();
    expect(reporterState.captureError).not.toHaveBeenCalled();
    expect(reporterState.captureMessage).not.toHaveBeenCalled();
  });

  it("捕获降级:渲染内置降级 UI 并上报 react_render_error", () => {
    bombState.shouldThrow = true;
    renderWithBoundary();
    expect(screen.getByRole("alert")).toHaveTextContent("页面出了点小问题");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(reporterState.captureError).toHaveBeenCalledTimes(1);
    const payload = reporterState.captureError.mock.calls[0][0];
    expect(payload.kind).toBe("react_render_error");
    expect(payload.message).toBe("boom");
    expect(payload.extra.componentStack).toBeTruthy();
  });

  it("重试恢复:重置错误态后子树重新渲染,不追加重复上报", () => {
    bombState.shouldThrow = true;
    renderWithBoundary();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(reporterState.captureError).toHaveBeenCalledTimes(1);

    bombState.shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(screen.getByText("页面内容")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(reporterState.captureError).toHaveBeenCalledTimes(1);
  });

  it("恢复后再次崩溃:重新降级并再次上报(每次渲染错误各记一条)", () => {
    bombState.shouldThrow = true;
    const { rerender } = renderWithBoundary("first");
    expect(screen.getByRole("alert")).toBeInTheDocument();

    bombState.shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(screen.getByText("页面内容")).toBeInTheDocument();

    bombState.shouldThrow = true;
    rerender(
      <ErrorBoundary>
        <Bomb key="second" />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(reporterState.captureError).toHaveBeenCalledTimes(2);
  });

  it("自定义 fallback:传入时渲染自定义 UI,上报照发", () => {
    bombState.shouldThrow = true;
    render(
      <ErrorBoundary fallback={<div>自定义降级</div>}>
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText("自定义降级")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    expect(reporterState.captureError).toHaveBeenCalledTimes(1);
  });
});

describe("captureRenderError(上报载荷)", () => {
  beforeEach(() => {
    reporterState.captureError.mockClear();
  });

  it("浏览器环境经 reporter 上报,载荷含 stack 与 componentStack", () => {
    captureRenderError(new Error("render boom"), "    at Bomb");
    expect(reporterState.captureError).toHaveBeenCalledTimes(1);
    const payload = reporterState.captureError.mock.calls[0][0];
    expect(payload.kind).toBe("react_render_error");
    expect(payload.message).toBe("render boom");
    expect(payload.stack).toContain("render boom");
    expect(payload.extra.componentStack).toBe("    at Bomb");
  });

  it("空值边界:message 缺失回落 String 化,componentStack 缺省存空串", () => {
    const error = new Error();
    error.message = "";
    captureRenderError(error, null);
    const payload = reporterState.captureError.mock.calls[0][0];
    expect(typeof payload.message).toBe("string");
    expect(payload.message.length).toBeGreaterThan(0);
    expect(payload.extra.componentStack).toBe("");
  });
});
