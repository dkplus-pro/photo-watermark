// routes/loading.tsx 路由级 loading 约定(docs/site-shell-plan.md 阶段 5.1):默认导出
// 作为该层级路由 Suspense fallback,渲染统一骨架屏占位。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import RouteLoading from "../src/routes/loading";

describe("routes/loading 路由级 loading 约定", () => {
  it("默认导出渲染 PageLoading 骨架屏占位", () => {
    render(<RouteLoading />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "页面加载中");
  });
});
