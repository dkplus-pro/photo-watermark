// PageLoading 骨架屏占位(docs/site-shell-plan.md 阶段 5.1):加载状态语义(role=status
// + aria-label)与静态骨架结构;纯静态组件,无数据依赖。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PageLoading from "../src/components/page-loading";

describe("PageLoading 骨架屏", () => {
  it("渲染加载状态占位(role=status + aria-label)与骨架块", () => {
    const { container } = render(<PageLoading />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-label", "页面加载中");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".page-loading-block").length).toBeGreaterThan(0);
    expect(container.querySelector(".page-loading-title")).toBeInTheDocument();
    expect(container.querySelectorAll(".page-loading-line").length).toBeGreaterThan(0);
  });
});
