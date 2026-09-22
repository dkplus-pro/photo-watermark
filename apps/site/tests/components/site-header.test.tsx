// site-header 响应式与抽屉开合(docs/quality-and-site-plan.md 阶段 18 用例清单):
// 断点判定走 window.matchMedia,setup 默认 matches:false(桌面),移动端用例重写为 true。
// Modern.js 的 Link 依赖完整 Router 上下文,组件单测里以语义等价的 a 标签替身替代。
vi.mock("@modern-js/runtime/router", async () => {
  const { createElement } = await import("react");
  return {
    Link: (props: { to: string; children?: ReactNode }) =>
      createElement("a", { href: props.to }, props.children)
  };
});

import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import SiteHeader from "../../src/components/site-header";
import { useUiStore } from "../../src/store/ui";
function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false
      }) as MediaQueryList
  });
}

function renderHeader() {
  return render(<SiteHeader siteName="测试站" />);
}

describe("SiteHeader 桌面端", () => {
  it("渲染站名与横向导航,不渲染汉堡按钮", async () => {
    mockMatchMedia(false);
    renderHeader();
    expect(screen.getByText("测试站")).toBeInTheDocument();
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开导航" })).not.toBeInTheDocument();
  });
});

describe("SiteHeader 移动端", () => {
  it("折叠为汉堡按钮,横向导航消失", async () => {
    mockMatchMedia(true);
    renderHeader();
    const trigger = await screen.findByRole("button", { name: "打开导航" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("点击汉堡打开抽屉,点导航项收起(开合闭环)", async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    renderHeader();
    const trigger = await screen.findByRole("button", { name: "打开导航" });

    await user.click(trigger);
    expect(useUiStore.getState().mobileMenuOpen).toBe(true);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const drawer = await screen.findByText("首页");
    expect(drawer).toBeInTheDocument();

    await user.click(drawer);
    expect(useUiStore.getState().mobileMenuOpen).toBe(false);
    expect(screen.getByRole("button", { name: "打开导航" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });
});
