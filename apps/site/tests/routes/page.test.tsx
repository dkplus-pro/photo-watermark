// page.tsx 首页主视觉(任务卡 6.1):有数据时渲染 eager Logo + 站名;loader 降级 null 时
// 兜底站名(FALLBACK_SITE_NAME)、不渲染 Logo(useLoaderData 以替身受控,Router 上下文
// 不进组件单测;loader 自身的降级语义已在 tests/routes/loaders.test.ts 固化)。
const h = vi.hoisted(() => ({ loaderData: { value: null as unknown } }));

vi.mock("@modern-js/runtime/router", () => ({
  useLoaderData: () => h.loaderData.value
}));

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import HomePage from "../../src/routes/page";

beforeEach(() => {
  h.loaderData.value = null;
});

describe("HomePage 首页主视觉", () => {
  it("有数据:渲染 eager Logo(强制尺寸)与站名标题", () => {
    h.loaderData.value = { siteName: "测试站", logoUrl: "https://cdn.example.com/logo.png" };
    render(<HomePage />);
    const img = screen.getByRole("img", { name: "测试站" });
    expect(img).toHaveAttribute("src", "https://cdn.example.com/logo.png");
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("width", "48");
    expect(img).toHaveAttribute("height", "48");
    expect(img).toHaveClass("site-home-logo");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("测试站");
  });

  it("无数据降级:loader 返回 null 时兜底站名,不渲染 Logo", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CMS Template");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
