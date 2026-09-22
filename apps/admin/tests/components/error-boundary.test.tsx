// ErrorBoundary 用例:子组件渲染期 throw → fallback 卡片;reset(重试)后恢复。
// 边界:事件回调内的 throw 不属于渲染期,不被边界捕获(React 仅捕获渲染期错误,
// 事件回调错误经 window.reportError 上报)——用例固化该语义。
// 说明:ErrorFallback 依赖 Modern.js router 的 useNavigate,这里按模块边界 mock。
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSX } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import ErrorBoundary from "../../src/components/error-boundary";

const navigateMock = vi.fn();
vi.mock("@modern-js/runtime/router", () => ({
  useNavigate: () => navigateMock
}));

// 渲染期炸弹:throwOnRender 为 true 时渲染抛错
let throwOnRender = true;
function Bomb(): JSX.Element {
  if (throwOnRender) {
    throw new Error("boom-render");
  }
  return <p>页面正常</p>;
}

// 事件回调炸弹:渲染正常,点击时抛错(React 不将其视为渲染期错误)
function EventBomb(): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => {
        throw new Error("boom-event");
      }}
    >
      触发回调错误
    </button>
  );
}

afterEach(() => {
  throwOnRender = true;
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  test("子组件渲染期 throw:展示 fallback 错误卡片与错误摘要", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    await waitFor(() => expect(screen.getByText("页面出错了")).toBeInTheDocument());
    expect(screen.getByText(/boom-render/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByText("页面正常")).not.toBeInTheDocument();
  });

  test("点击重试(reset):边界 state 复位,子组件重新渲染恢复", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    await waitFor(() => expect(screen.getByText("页面出错了")).toBeInTheDocument());

    // 错误源消除(真实场景:外部状态恢复或路由跳转后重渲染)
    throwOnRender = false;
    rerender(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("页面正常")).toBeInTheDocument();
    expect(screen.queryByText("页面出错了")).not.toBeInTheDocument();
  });

  test("事件回调内的 throw 不被边界捕获(fallback 不出现,children 保持渲染)", async () => {
    // React 19 不把事件回调错误交给错误边界:错误沿 jsdom 事件分发上抛为
    // window "error" 事件(未被边界捕获)。这里监听并记录该事件,
    // 同时固化"错误上报为 window error 事件、边界不受影响"的语义。
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const errorEvents: ErrorEvent[] = [];
    const onError = (event: ErrorEvent): void => {
      errorEvents.push(event);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    render(
      <ErrorBoundary>
        <EventBomb />
      </ErrorBoundary>
    );
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "触发回调错误" }));
    });
    window.removeEventListener("error", onError);

    // 错误被上报为 window error 事件,但边界未切换到 fallback
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].error?.message).toBe("boom-event");
    expect(screen.getByText("触发回调错误")).toBeInTheDocument();
    expect(screen.queryByText("页面出错了")).not.toBeInTheDocument();
  });
});
