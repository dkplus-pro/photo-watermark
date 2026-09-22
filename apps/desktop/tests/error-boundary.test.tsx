// ErrorBoundary 三态(正常渲染/捕获降级/重试恢复)+ react_render_error 上报断言
// (docs/desktop-shell-plan.md §4 阶段 3,用例风格对齐 apps/site/tests/error-boundary.test.tsx)。
// 边界用例:空 message 兜底文案(空值)、上报抛错不影响降级 UI(网络失败类)。
// 与 site 的差异:路由是 react-router-dom,用 MemoryRouter 真上下文代替 mock;
// 上报以 vi.mock(sdk/monitor)替身断言 reportRenderError 调用。
const h = vi.hoisted(() => ({
  reportRenderError: vi.fn()
}));

vi.mock("../src/renderer/src/sdk/monitor", () => ({
  reportRenderError: h.reportRenderError
}));

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import ErrorBoundary from "../src/renderer/src/component/error-boundary";

const reportRenderErrorMock = h.reportRenderError;

// 抛错开关:重试用例在恢复阶段关闭抛错,验证边界 state 重置后子树重新渲染。
let shouldThrow = false;

function Boom() {
  if (shouldThrow) {
    throw new Error("boom");
  }
  return <div>ok-content</div>;
}

// 当前路由探针:断言"返回首页"真的把 Hash 路由跳回 "/"。
function LocationProbe() {
  const { pathname } = useLocation();
  return <span data-testid="route">{pathname}</span>;
}

function renderBoundary(initialPath = "/some-page") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ErrorBoundary>
        <Boom />
        <LocationProbe />
      </ErrorBoundary>
    </MemoryRouter>
  );
}

// React dev 会在 console.error 输出被捕获的渲染错误(含边界自身埋的日志),测试里静音。
let consoleErrorSpy: MockInstance;

beforeEach(() => {
  shouldThrow = false;
  reportRenderErrorMock.mockClear();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("ErrorBoundary 三态", () => {
  it("正常渲染:子树原样输出,不上报", () => {
    renderBoundary();
    expect(screen.getByText("ok-content")).toBeInTheDocument();
    expect(screen.getByTestId("route")).toHaveTextContent("/some-page");
    expect(reportRenderErrorMock).not.toHaveBeenCalled();
  });

  it("捕获降级:展示兜底文案与错误摘要,上报 react_render_error(带组件栈)", () => {
    shouldThrow = true;
    renderBoundary();
    expect(screen.getByText("页面出错了")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(reportRenderErrorMock).toHaveBeenCalledTimes(1);
    const [reportedError, reportedStack] = reportRenderErrorMock.mock.calls[0] ?? [];
    expect(reportedError).toBeInstanceOf(Error);
    expect(reportedError?.message).toBe("boom");
    expect(reportedStack).toEqual(expect.any(String));
  });

  it("重试恢复:子树不再抛错后重置错误态,不重复上报", async () => {
    shouldThrow = true;
    const user = userEvent.setup();
    renderBoundary();
    expect(screen.getByText("页面出错了")).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(screen.getByText("ok-content")).toBeInTheDocument();
    expect(reportRenderErrorMock).toHaveBeenCalledTimes(1);
  });

  it("返回首页:重置错误态并把路由跳回 /", async () => {
    shouldThrow = true;
    const user = userEvent.setup();
    renderBoundary();
    expect(screen.getByText("页面出错了")).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: "返回首页" }));
    expect(screen.getByText("ok-content")).toBeInTheDocument();
    expect(screen.getByTestId("route")).toHaveTextContent("/");
  });
});

describe("ErrorBoundary 边界", () => {
  it("空 message:降级文案兜底为未知错误提示,上报仍带空串 message(空值边界)", () => {
    shouldThrow = true;
    function BoomEmpty(): never {
      throw new Error("");
    }
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ErrorBoundary>
          <BoomEmpty />
        </ErrorBoundary>
      </MemoryRouter>
    );
    expect(screen.getByText("渲染时发生未知错误,请稍后重试")).toBeInTheDocument();
    const [reportedError] = reportRenderErrorMock.mock.calls[0] ?? [];
    expect(reportedError?.message).toBe("");
  });

  it("上报抛错不冒泡:降级 UI 不受影响(上报环节绝不拖垮边界,网络失败类)", () => {
    shouldThrow = true;
    reportRenderErrorMock.mockImplementation(() => {
      throw new Error("send failed");
    });
    renderBoundary();
    expect(screen.getByText("页面出错了")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
