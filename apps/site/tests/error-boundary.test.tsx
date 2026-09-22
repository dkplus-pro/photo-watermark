// ErrorBoundary 三态(正常渲染/捕获降级/重试恢复)+ react_render_error 上报断言
// (docs/site-shell-plan.md 阶段 5.1 验收)。边界用例:空 message 兜底文案(空值)、
// 上报抛错不影响降级 UI(网络失败类)。Modern.js 的 useNavigate 依赖完整 Router
// 上下文,以空实现替身替代;tracking facade 以 vi.mock 替身断言上报调用。
const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  track: vi.fn()
}));

vi.mock("@modern-js/runtime/router", () => ({
  useNavigate: () => h.navigate
}));

vi.mock("../src/tracking", () => ({ track: h.track }));

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import ErrorBoundary from "../src/components/error-boundary";

const trackMock = h.track;

// 抛错开关:重试用例在恢复阶段关闭抛错,验证边界 state 重置后子树重新渲染。
let shouldThrow = false;

function Boom() {
  if (shouldThrow) {
    throw new Error("boom");
  }
  return <div>ok-content</div>;
}

// React dev 会在 console.error 输出被捕获的渲染错误(含边界自身埋的日志),测试里静音。
let consoleErrorSpy: MockInstance;

beforeEach(() => {
  shouldThrow = false;
  trackMock.mockClear();
  h.navigate.mockClear();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("ErrorBoundary 三态", () => {
  it("正常渲染:子树原样输出,不上报", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText("ok-content")).toBeInTheDocument();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("捕获降级:展示兜底文案与错误摘要,上报 react_render_error", () => {
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText("页面出错了")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      "react_render_error",
      expect.objectContaining({ message: "boom", component_stack: expect.any(String) })
    );
  });

  it("重试恢复:子树不再抛错后重置错误态,不重复上报", async () => {
    shouldThrow = true;
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText("页面出错了")).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(screen.getByText("ok-content")).toBeInTheDocument();
    expect(trackMock).toHaveBeenCalledTimes(1);
  });

  it("返回首页:重置错误态并跳转首页(任务卡 6.1 覆盖补缺)", async () => {
    shouldThrow = true;
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText("页面出错了")).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: "返回首页" }));
    expect(screen.getByText("ok-content")).toBeInTheDocument();
    expect(h.navigate).toHaveBeenCalledWith("/");
  });
});

describe("ErrorBoundary 边界", () => {
  it("空 message:降级文案兜底为未知错误提示,上报仍带空串 message", () => {
    shouldThrow = true;
    function BoomEmpty() {
      throw new Error("");
    }
    render(
      <ErrorBoundary>
        <BoomEmpty />
      </ErrorBoundary>
    );
    expect(screen.getByText("渲染时发生未知错误,请稍后重试")).toBeInTheDocument();
    expect(trackMock).toHaveBeenCalledWith(
      "react_render_error",
      expect.objectContaining({ message: "" })
    );
  });

  it("上报抛错不冒泡:降级 UI 不受影响(上报环节绝不拖垮边界)", () => {
    shouldThrow = true;
    trackMock.mockImplementation(() => {
      throw new Error("send failed");
    });
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText("页面出错了")).toBeInTheDocument();
  });
});
