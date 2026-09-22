// 相框列表页用例(阶段 12)。
// 六类边界覆盖:空值/零值(清单为空、loading 首轮不得闪空态)、越界(条数不整除列数)、
// 网络失败(清单装载失败 → Alert + 重试)。
// 权限缺失不适用:本站匿名公开、无鉴权与权限码(apps/admin/AGENTS.md 第 3 节)。
// 非法状态迁移不适用:本页无状态机,清单装载状态机在 store/frame-catalog(另有其用例),
// 页面这一侧唯一会出错的状态迁移是「装载中/装载失败」的优先级,已单独有用例锁住。
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { FrameCatalogEntry } from "../../../src/types";

const catalogMock = vi.hoisted(() => ({
  frames: [] as FrameCatalogEntry[],
  loading: false,
  error: null as string | null,
  reload: vi.fn(async () => undefined)
}));
const assetUrlMock = vi.hoisted(() => vi.fn((path: string) => `/${path}`));
const navigateMock = vi.hoisted(() => vi.fn());
const responsiveMock = vi.hoisted(() => ({ isMobile: false, isTablet: false }));

// 清单装载是本页唯一的外部数据入口,按模块边界 mock(store 不参与本用例)。
vi.mock("../../../src/hooks/use-frame-catalog", () => ({
  useFrameCatalog: () => ({
    frames: catalogMock.frames,
    logos: [],
    loading: catalogMock.loading,
    error: catalogMock.error,
    reload: catalogMock.reload
  })
}));

// 列数由断点 hook 决定,直接给定三档组合,不依赖 jsdom 的 innerWidth。
vi.mock("../../../src/hooks/use-responsive", () => ({
  useIsMobile: () => responsiveMock.isMobile,
  useIsTablet: () => responsiveMock.isTablet
}));

// 锁住「public 资源必须经 assetUrl」这条硬约束:断言它收到的仍是相对 public 根的原路径。
vi.mock("../../../src/utils/asset-url", () => ({
  assetUrl: assetUrlMock
}));

// PageContainer 与卡片都要 router:卡片只消费 useNavigate,面包屑只消费 useLocation。
vi.mock("@modern-js/runtime/router", () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: "/frames" })
}));

import FramesListPage from "../../../src/routes/frames/page";

const FOUR_FRAMES = [1, 2, 3, 4];

function makeEntry(index: number): FrameCatalogEntry {
  return {
    id: `style-${index}`,
    name: `样式${index}`,
    thumbnail: `assets/thumbs/style-${index}.svg`,
    sortOrder: index * 10
  };
}

function makeEntries(count: number): FrameCatalogEntry[] {
  return Array.from({ length: count }, (_unused, index) => makeEntry(index + 1));
}

/** arco Col 的 span 落在类名上(arco-col-6 / -8 / -12),用它断言列数。 */
function spansOfCells(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".arco-col")).map(
    (cell) => cell.className.match(/arco-col-(\d+)/u)?.[1] ?? ""
  );
}

function namesOfCards(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".frame-card-name")).map(
    (node) => node.textContent ?? ""
  );
}

beforeEach(() => {
  assetUrlMock.mockClear();
  navigateMock.mockClear();
  catalogMock.reload.mockClear();
  catalogMock.frames = makeEntries(4);
  catalogMock.loading = false;
  catalogMock.error = null;
  responsiveMock.isMobile = false;
  responsiveMock.isTablet = false;
});

afterEach(cleanup);

describe("清单渲染", () => {
  test("4 条清单渲染 4 张卡片,卡片文案与 name 一致", () => {
    const { container } = render(<FramesListPage />);

    expect(container.querySelectorAll(".frame-card")).toHaveLength(4);
    expect(namesOfCards(container)).toEqual(FOUR_FRAMES.map((index) => `样式${index}`));
  });

  test("缩略图路径经 assetUrl 拼接,页面不硬编码资源路径", () => {
    catalogMock.frames = makeEntries(2);
    render(<FramesListPage />);

    expect(assetUrlMock.mock.calls.map(([path]) => path)).toEqual([
      "assets/thumbs/style-1.svg",
      "assets/thumbs/style-2.svg"
    ]);
    // 卡片拿到的 src 必须是 assetUrl 的返回值(而非清单里的裸相对路径)。
    const thumb = screen
      .getByRole("link", { name: /样式1/u })
      .querySelector("img") as HTMLImageElement;
    expect(thumb.getAttribute("src")).toBe("/assets/thumbs/style-1.svg");
  });

  test("越界:条数不整除列数(3 条 × 桌面 4 列)不报错,渲染 3 张", () => {
    catalogMock.frames = makeEntries(3);
    const { container } = render(<FramesListPage />);

    expect(container.querySelectorAll(".frame-card")).toHaveLength(3);
    expect(container.querySelector(".frame-grid--desktop")).not.toBeNull();
  });

  test("页面不再排序,按清单顺序渲染(排序是 store 的职责)", () => {
    catalogMock.frames = [
      { id: "wide", name: "宽边白框", thumbnail: "assets/thumbs/wide.svg", sortOrder: 999 },
      { id: "plain", name: "基础黑框", thumbnail: "assets/thumbs/plain.svg", sortOrder: 1 }
    ];
    const { container } = render(<FramesListPage />);

    expect(namesOfCards(container)).toEqual(["宽边白框", "基础黑框"]);
  });
});

describe("卡片点击进入导出页", () => {
  test("点卡片内的文案即整卡生效,跳 /frames/<id>/export", async () => {
    render(<FramesListPage />);

    await userEvent.click(screen.getByText("样式3"));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith("/frames/style-3/export");
  });

  test("卡片是 `<a>`:href 指向导出页,中键/新标签等原生行为可用", () => {
    catalogMock.frames = makeEntries(1);
    render(<FramesListPage />);

    const card = screen.getByRole("link", { name: /样式1/u });
    expect(card.getAttribute("href")).toBe("/frames/style-1/export");
    // 移动端没有 hover,进入标记必须常驻可见。
    expect(card.textContent).toContain("去导出");
  });

  test("顶部说明文案在,且不放操作按钮(列表页无批量动作)", () => {
    const { container } = render(<FramesListPage />);

    expect(screen.getByText("选择一种相框样式,进入批量导出")).toBeInTheDocument();
    expect(container.querySelector(".app-page-extra button")).toBeNull();
  });
});

describe("响应式列数", () => {
  test("桌面 4 列(span 6)", () => {
    const { container } = render(<FramesListPage />);

    expect(container.querySelector(".frame-grid--desktop")).not.toBeNull();
    expect(spansOfCells(container)).toEqual(["6", "6", "6", "6"]);
  });

  test("平板 3 列(span 8)", () => {
    responsiveMock.isTablet = true;
    catalogMock.frames = makeEntries(3);
    const { container } = render(<FramesListPage />);

    expect(container.querySelector(".frame-grid--tablet")).not.toBeNull();
    expect(spansOfCells(container)).toEqual(["8", "8", "8"]);
  });

  test("手机 2 列(span 12)", () => {
    responsiveMock.isMobile = true;
    const { container } = render(<FramesListPage />);

    expect(container.querySelector(".frame-grid--mobile")).not.toBeNull();
    expect(spansOfCells(container)).toEqual(["12", "12", "12", "12"]);
  });

  test("占位卡数量跟列数走,手机 2 列只铺 2 张", () => {
    responsiveMock.isMobile = true;
    catalogMock.loading = true;
    catalogMock.frames = [];
    const { container } = render(<FramesListPage />);

    expect(container.querySelectorAll(".frame-card-placeholder")).toHaveLength(2);
  });
});

describe("装载状态", () => {
  test("loading 渲染骨架占位卡,不渲染真实卡片、不闪空态", () => {
    catalogMock.loading = true;
    catalogMock.frames = [];
    const { container } = render(<FramesListPage />);

    expect(container.querySelector(".arco-skeleton")).not.toBeNull();
    expect(container.querySelectorAll(".frame-card")).toHaveLength(0);
    expect(screen.queryByText("暂无可用相框")).not.toBeInTheDocument();
  });

  test("空值:清单为空渲染 Empty 与 frames.json 指引", () => {
    catalogMock.frames = [];
    const { container } = render(<FramesListPage />);

    expect(screen.getByText("暂无可用相框")).toBeInTheDocument();
    expect(screen.getByText(/public\/frames\.json/u)).toBeInTheDocument();
    expect(container.querySelectorAll(".frame-card")).toHaveLength(0);
  });

  test("网络失败:Alert 说明清单装载失败,点重试调 reload 一次", async () => {
    catalogMock.error = "frames.json 请求失败";
    const { container } = render(<FramesListPage />);

    expect(container.querySelector(".arco-alert-error")).not.toBeNull();
    expect(screen.getByText(/清单装载失败/u)).toBeInTheDocument();
    // 原始装载错误要原样露出,不能糊成一句「出错了」。
    expect(screen.getByText("frames.json 请求失败")).toBeInTheDocument();
    expect(screen.queryByText("样式1")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /重试/u }));
    expect(catalogMock.reload).toHaveBeenCalledTimes(1);
  });

  test("判定顺序:装载中同时带错误时按错误渲染,不留永远转圈的死局", () => {
    catalogMock.loading = true;
    catalogMock.error = "frames.json 请求失败";
    const { container } = render(<FramesListPage />);

    expect(container.querySelector(".arco-alert-error")).not.toBeNull();
    expect(container.querySelector(".arco-skeleton")).toBeNull();
  });
});
