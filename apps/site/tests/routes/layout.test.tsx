// layout.tsx 装配结构(docs/site-shell-plan.md 阶段 5.1 装配 + 任务卡 6.1):
// ConfigProvider(react-19 适配器/locale/theme)+ 双层 ErrorBoundary(根层兜壳层、页面层兜
// Outlet)+ useRum / initTracking 客户端装配 + 站名兜底。双层边界用行为断言验证:
// Outlet 抛错 → 内层边界兜住、壳层(页头/页脚)仍可用;壳层(页头)抛错 → 外层边界兜住、整树降级。
// Router 上下文以替身替代(useLoaderData 受控数据源、Outlet 按开关抛错、useNavigate 空实现);
// SiteHeader 以按开关抛错的替身替代(组件自身用例见 tests/components/site-header.test.tsx);
// tracking facade 以 vi.mock 替身断言装配调用(initTracking 替身避免拉起 web-vitals 动态依赖)。
const h = vi.hoisted(() => ({
  loaderData: { value: null as unknown },
  outletThrows: { value: false },
  headerThrows: { value: false },
  initTracking: vi.fn(),
  track: vi.fn(),
  navigate: vi.fn()
}));

vi.mock("@modern-js/runtime/router", async () => {
  const { createElement } = await import("react");
  return {
    Outlet: () => {
      if (h.outletThrows.value) {
        throw new Error("outlet boom");
      }
      return createElement("div", null, "outlet-content");
    },
    useLoaderData: () => h.loaderData.value,
    useNavigate: () => h.navigate
  };
});

vi.mock("../../src/tracking", () => ({ initTracking: h.initTracking, track: h.track }));

vi.mock("../../src/components/site-header", async () => {
  const { createElement } = await import("react");
  return {
    default: (props: { siteName: string }) => {
      if (h.headerThrows.value) {
        throw new Error("header boom");
      }
      return createElement("header", null, props.siteName);
    }
  };
});

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import SiteLayout from "../../src/routes/layout";

// RUM 初始化读真实 env;测试内清空保证守卫语义(缺失即不初始化)不受本机环境影响。
let consoleErrorSpy: MockInstance;

beforeEach(() => {
  h.loaderData.value = null;
  h.outletThrows.value = false;
  h.headerThrows.value = false;
  h.initTracking.mockClear();
  h.track.mockClear();
  h.navigate.mockClear();
  vi.stubEnv("RUM_ENDPOINT", "");
  vi.stubEnv("RUM_PID", "");
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("SiteLayout 装配结构", () => {
  it("壳层按序装配:页头(站名/Logo)/主内容 Outlet/页脚,埋点初始化仅调用一次", () => {
    h.loaderData.value = { siteName: "测试站", logoUrl: "https://cdn.example.com/logo.png" };
    const { container } = render(<SiteLayout />);
    expect(screen.getByText("测试站")).toBeInTheDocument();
    expect(screen.getByText("outlet-content")).toBeInTheDocument();
    expect(screen.getByText("© 2026 CMS Template")).toBeInTheDocument();
    expect(container.querySelector(".site-shell")).toBeInTheDocument();
    expect(container.querySelector(".site-main")).toBeInTheDocument();
    expect(h.initTracking).toHaveBeenCalledTimes(1);
  });

  it("站名兜底:layout loader 降级 null 时回退 FALLBACK_SITE_NAME", () => {
    h.loaderData.value = null;
    render(<SiteLayout />);
    expect(screen.getByText("CMS Template")).toBeInTheDocument();
  });
});

describe("SiteLayout 双层 ErrorBoundary", () => {
  it("页面层边界:Outlet 渲染错误被内层兜住并上报,壳层(页头/页脚)保持可用", () => {
    h.loaderData.value = { siteName: "测试站" };
    h.outletThrows.value = true;
    const { container } = render(<SiteLayout />);
    expect(screen.getByText("页面出错了")).toBeInTheDocument();
    expect(screen.getByText("outlet boom")).toBeInTheDocument();
    expect(screen.getByText("测试站")).toBeInTheDocument();
    expect(screen.getByText("© 2026 CMS Template")).toBeInTheDocument();
    expect(container.querySelector(".site-shell")).toBeInTheDocument();
    expect(h.track).toHaveBeenCalledWith(
      "react_render_error",
      expect.objectContaining({ message: "outlet boom" })
    );
  });

  it("根层边界:壳层渲染错误被外层兜住,整树降级不再输出壳层", () => {
    h.loaderData.value = { siteName: "测试站" };
    h.headerThrows.value = true;
    const { container } = render(<SiteLayout />);
    expect(screen.getByText("页面出错了")).toBeInTheDocument();
    expect(screen.queryByText("outlet-content")).not.toBeInTheDocument();
    expect(container.querySelector(".site-shell")).not.toBeInTheDocument();
    expect(h.track).toHaveBeenCalledWith(
      "react_render_error",
      expect.objectContaining({ message: "header boom" })
    );
  });
});
