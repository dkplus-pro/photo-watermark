// PageContainer 组件用例(阶段 16 测试用例清单,见 docs/quality-and-site-plan.md)。
// vitest 基座未开 globals,RTL 不自动清理,须手动 cleanup。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

// PageContainer 只消费 router 的 useLocation 与 Link,直接 mock 掉即可
// (mock 边界纪律:不 mock 组件内部实现细节;菜单链用真实 config/menu.tsx)。
const mockRouter = vi.hoisted(() => ({ pathname: "/admin/system/users" }));

vi.mock("@modern-js/runtime/router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useLocation: () => ({ pathname: mockRouter.pathname })
}));

import PageContainer from "../../src/components/page-container";

afterEach(cleanup);

test("渲染完整面包屑链(首页 / 系统管理 / 用户管理)", () => {
  mockRouter.pathname = "/admin/system/users";
  const { container } = render(
    <PageContainer>
      <div>页面内容</div>
    </PageContainer>
  );

  expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute("href", "/");
  // DOM 顺序:首页在最前,目录与叶子按菜单链排列。
  const text = container.querySelector(".page-breadcrumb")?.textContent ?? "";
  expect(text.indexOf("首页")).toBeGreaterThanOrEqual(0);
  expect(text.indexOf("系统管理")).toBeGreaterThan(text.indexOf("首页"));
  expect(text.indexOf("用户管理")).toBeGreaterThan(text.indexOf("系统管理"));
});

test("不再渲染页内标题(.page-title / h3 均不出现)", () => {
  mockRouter.pathname = "/admin/system/users";
  const { container } = render(
    <PageContainer>
      <div>页面内容</div>
    </PageContainer>
  );

  expect(container.querySelector(".page-title")).toBeNull();
  expect(container.querySelector("h3")).toBeNull();
  expect(screen.getByText("页面内容")).toBeInTheDocument();
});

test("extra 插槽渲染在操作区;未传 extra 时不渲染操作区容器", () => {
  mockRouter.pathname = "/admin/system/users";
  const { container, unmount } = render(
    <PageContainer extra={<button type="button">新建</button>}>
      <div>页面内容</div>
    </PageContainer>
  );

  expect(container.querySelector(".page-extra")).not.toBeNull();
  expect(screen.getByRole("button", { name: "新建" })).toBeInTheDocument();
  unmount();

  mockRouter.pathname = "/admin/system/users";
  const bare = render(
    <PageContainer>
      <div>页面内容</div>
    </PageContainer>
  );
  expect(bare.container.querySelector(".page-extra")).toBeNull();
});

test("404 路径(trail 为空)不炸:仅剩首页面包屑,children 正常渲染", () => {
  mockRouter.pathname = "/admin/no-such-page";
  const { container } = render(
    <PageContainer>
      <div>兜底内容</div>
    </PageContainer>
  );

  expect(screen.getByRole("link", { name: "首页" })).toBeInTheDocument();
  expect(screen.getByText("兜底内容")).toBeInTheDocument();
  // 无菜单链叶子,也没有标题/操作区。
  expect(container.querySelector(".page-title")).toBeNull();
  expect(container.querySelector(".page-extra")).toBeNull();
});
