// PageContainer 用例(壳层 UI 骨架)。
// 边界覆盖:空值(breadcrumb 传 undefined / 空数组)、零值(菜单链为空时只剩首页)、
// 越界(未匹配路径、畸形路径)、非法状态迁移(抽屉开合同值写入不产生多余通知);
// 本站无鉴权、无网络,权限与网络两类边界不适用。
// __APP_BASE_PATH__ 由 vitest.config.ts 的 define 注入(与 modern.config.ts 同源)。
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

// PageContainer 只消费 router 的 useLocation 与 useNavigate,按模块边界 mock,
// 不 mock 组件内部实现细节;菜单链用真实 config/menu.tsx。
const mockRouter = vi.hoisted(() => ({ pathname: "/" }));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@modern-js/runtime/router", () => ({
  useLocation: () => ({ pathname: mockRouter.pathname }),
  useNavigate: () => navigateMock
}));

import PageContainer, { type BreadcrumbItem } from "../../src/components/page-container";
import { APP_BASENAME } from "../../src/constants";
import { useUiStore } from "../../src/store/ui";

afterEach(cleanup);

// 应用内路径拼上 basename,与真实部署下的 location.pathname 同形。
const at = (appPathname: string) => `${APP_BASENAME === "/" ? "" : APP_BASENAME}${appPathname}`;

function textOf(container: HTMLElement): string {
  return container.querySelector(".app-page-breadcrumb")?.textContent ?? "";
}

describe("自动面包屑", () => {
  test("列表页渲染「首页 / 相框列表」,顺序正确", () => {
    mockRouter.pathname = at("/frames");
    const { container } = render(
      <PageContainer>
        <div>页面内容</div>
      </PageContainer>
    );

    const text = textOf(container);
    expect(text).toContain("首页");
    expect(text.indexOf("首页")).toBeLessThan(text.indexOf("相框列表"));
    expect(screen.getByText("页面内容")).toBeInTheDocument();
  });

  test("子路由(/frames/:styleId/export)按最长前缀归到相框列表,链不断", () => {
    mockRouter.pathname = at("/frames/silver/export");
    const { container } = render(
      <PageContainer>
        <div>导出页</div>
      </PageContainer>
    );

    // 全链:首页 / 水印相框(目录)/ 相框列表;导出页尾项由页面经 breadcrumb 追加。
    expect(textOf(container)).toBe("首页水印相框相框列表");
  });

  test("点击「首页」跳相框列表(D14:`/` 只做重定向,首页项不指 `/`)", async () => {
    mockRouter.pathname = at("/frames/silver/export");
    render(
      <PageContainer>
        <div>导出页</div>
      </PageContainer>
    );

    await userEvent.click(screen.getByText("首页"));
    expect(navigateMock).toHaveBeenCalledWith("/frames");
  });

  test("末项不可点:链尾的「相框列表」点击不触发跳转", async () => {
    mockRouter.pathname = at("/frames");
    render(
      <PageContainer>
        <div>列表</div>
      </PageContainer>
    );

    await userEvent.click(screen.getByText("相框列表"));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("未匹配路径(404 / 畸形路径)只剩首页,children 正常渲染", async () => {
    mockRouter.pathname = at("/no-such-page");
    const { container } = render(
      <PageContainer>
        <div>兜底内容</div>
      </PageContainer>
    );

    expect(textOf(container)).toBe("首页");
    expect(container.querySelector(".app-page")).not.toBeNull();
    expect(screen.getByText("兜底内容")).toBeInTheDocument();
    // 首页此时是末项,不再可点。
    await userEvent.click(screen.getByText("首页"));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("不带 basename 前缀的路径原样参与匹配,不抛错", () => {
    mockRouter.pathname = "/frames";
    const { container } = render(
      <PageContainer>
        <div>内容</div>
      </PageContainer>
    );
    expect(textOf(container)).toBe("首页水印相框相框列表");
  });
});

describe("breadcrumb 显式传入", () => {
  test("给了就完全采用,不再自动推导菜单链", async () => {
    mockRouter.pathname = at("/frames");
    const breadcrumb: BreadcrumbItem[] = [
      { title: "相框列表", path: "/frames" },
      { title: "批量导出" }
    ];
    const { container } = render(
      <PageContainer breadcrumb={breadcrumb}>
        <div>导出页</div>
      </PageContainer>
    );

    expect(textOf(container)).toBe("相框列表批量导出");
    await userEvent.click(screen.getByText("相框列表"));
    expect(navigateMock).toHaveBeenCalledWith("/frames");
  });

  test("空数组(空值)按传入语义渲染成空面包屑,不回落到自动链", () => {
    mockRouter.pathname = at("/frames");
    const { container } = render(
      <PageContainer breadcrumb={[]}>
        <div>内容</div>
      </PageContainer>
    );

    expect(textOf(container)).toBe("");
    expect(screen.queryByText("首页")).not.toBeInTheDocument();
  });

  test("重复渲染同一路由与同一 breadcrumb 不产生重复项", () => {
    mockRouter.pathname = at("/frames");
    const breadcrumb: BreadcrumbItem[] = [{ title: "相框列表", path: "/frames" }];
    const { container, rerender } = render(
      <PageContainer breadcrumb={breadcrumb}>
        <div>内容</div>
      </PageContainer>
    );
    rerender(
      <PageContainer breadcrumb={breadcrumb}>
        <div>内容</div>
      </PageContainer>
    );

    expect(container.querySelectorAll(".app-page-breadcrumb .arco-breadcrumb-item")).toHaveLength(
      1
    );
  });
});

describe("extra 操作区", () => {
  test("与面包屑同处顶部一行,且排在其后;未传时不渲染容器", async () => {
    mockRouter.pathname = at("/frames");
    const { container, unmount } = render(
      <PageContainer extra={<button type="button">导出</button>}>
        <div>内容</div>
      </PageContainer>
    );

    const header = container.querySelector(".app-page-header");
    expect(header).not.toBeNull();
    expect(header?.querySelector(".app-page-breadcrumb")).not.toBeNull();
    const extra = header?.querySelector(".app-page-extra");
    expect(extra).not.toBeNull();
    // 同一行:extra 与面包屑互为兄弟,且 DOM 顺序在面包屑之后(CSS 靠 margin-left:auto 靠右)。
    expect(extra?.previousElementSibling?.className).toContain("app-page-breadcrumb");
    expect(screen.getByRole("button", { name: "导出" })).toBeInTheDocument();
    unmount();

    const bare = render(
      <PageContainer>
        <div>内容</div>
      </PageContainer>
    );
    expect(bare.container.querySelector(".app-page-extra")).toBeNull();
  });

  test("不渲染页内标题(标题与面包屑叶子重复)", () => {
    mockRouter.pathname = at("/frames");
    const { container } = render(
      <PageContainer>
        <div>内容</div>
      </PageContainer>
    );

    expect(container.querySelector(".page-title")).toBeNull();
    expect(container.querySelector("h3")).toBeNull();
  });
});

describe("useUiStore 抽屉开合状态", () => {
  // 非法状态迁移:setMobileNavOpen 同值写入必须短路,重复 setMobileNavOpen(false) 不通知订阅者。
  test("同值写入不产生多余通知,异值写入才通知", () => {
    useUiStore.setState({ siderCollapsed: false, mobileNavOpen: false });
    const listener = vi.fn();
    const unsubscribe = useUiStore.subscribe(listener);

    useUiStore.getState().setMobileNavOpen(false);
    useUiStore.getState().setMobileNavOpen(false);
    expect(listener).not.toHaveBeenCalled();

    useUiStore.getState().setMobileNavOpen(true);
    expect(listener).toHaveBeenCalledTimes(1);
    useUiStore.getState().setMobileNavOpen(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  test("只持久化侧栏折叠偏好,抽屉开合与函数不入 storage", () => {
    useUiStore.setState({ siderCollapsed: false, mobileNavOpen: false });
    useUiStore.getState().toggleSider();
    useUiStore.getState().setMobileNavOpen(true);

    const stored = JSON.parse(window.localStorage.getItem("watermark-frame.ui") ?? "{}");
    expect(stored.state).toEqual({ siderCollapsed: true });
  });
});
