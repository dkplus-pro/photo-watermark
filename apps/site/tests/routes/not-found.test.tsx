// routes/$.tsx 全站 404 兜底页(任务卡 6.1):Arco Result 404 + 返回首页 Link(指向 /)。
// Modern.js 的 Link 依赖完整 Router 上下文,组件单测里以语义等价的 a 标签替身替代
// (与 site-header 用例同款)。
vi.mock("@modern-js/runtime/router", async () => {
  const { createElement } = await import("react");
  return {
    Link: (props: { to: string; children?: ReactNode }) =>
      createElement("a", { href: props.to }, props.children)
  };
});

import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFoundRoute from "../../src/routes/$";

describe("NotFoundRoute 404 兜底页", () => {
  it("渲染 404 结果页、说明文案与返回首页链接", () => {
    render(<NotFoundRoute />);
    expect(screen.getAllByText("404").length).toBeGreaterThan(0);
    expect(screen.getByText("页面不存在或已被移除")).toBeInTheDocument();
    const homeLink = screen.getByRole("link", { name: "返回首页" });
    expect(homeLink).toHaveAttribute("href", "/");
  });
});
