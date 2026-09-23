import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFrameCatalog } from "../../src/hooks/use-frame-catalog";
import { useFrameCatalogStore } from "../../src/store/frame-catalog";

/**
 * useFrameCatalog 组件侧单测(阶段 6)。
 *
 * mock 打在模块边界 `utils/catalog`:hook 的真实链路是「挂载 → store.load → 装载」,
 * 装载结果本身已由 utils/catalog 与 store 的用例分别覆盖。
 * 权限缺失一类边界本站不适用:无登录、无鉴权码。
 */

const { loadCatalogsMock } = vi.hoisted(() => ({ loadCatalogsMock: vi.fn() }));

vi.mock("../../src/utils/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/catalog")>();
  return { ...actual, loadCatalogs: loadCatalogsMock };
});

const catalogPayload = () => ({
  frames: {
    version: 1,
    frames: [
      {
        id: "plain-frame",
        name: "基础黑框",
        thumbnail: "assets/thumbs/plain-frame.jpg",
        sortOrder: 20
      },
      {
        id: "amber-frame",
        name: "琥珀边",
        thumbnail: "assets/thumbs/amber-frame.svg",
        sortOrder: 10
      }
    ]
  },
  logos: {
    version: 1,
    logos: [{ id: "juzi", name: "芥子科技", source: "assets/logos/juzi.svg", mark: "JUZI" }]
  }
});

/** 只读探针:把 hook 的返回值渲染成文本,顺带暴露重试按钮。 */
function CatalogProbe() {
  const { frames, logos, loading, error, reload } = useFrameCatalog();
  return (
    <div>
      <span data-testid="status">{error ? "error" : loading ? "loading" : "ready"}</span>
      <span data-testid="frames">{frames.map((entry) => entry.name).join(",")}</span>
      <span data-testid="logos">{logos.map((entry) => entry.name).join(",")}</span>
      <button type="button" onClick={() => void reload()}>
        重试
      </button>
    </div>
  );
}

beforeEach(() => {
  loadCatalogsMock.mockReset();
  useFrameCatalogStore.setState({ status: "idle", frames: [], logos: [], error: null });
});

describe("useFrameCatalog", () => {
  it("挂载即装载,loading 结束后透出排好序的清单", async () => {
    loadCatalogsMock.mockResolvedValue(catalogPayload());

    render(<CatalogProbe />);
    expect(screen.getByTestId("status")).toHaveTextContent("loading");

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("frames")).toHaveTextContent("琥珀边,基础黑框");
    expect(screen.getByTestId("logos")).toHaveTextContent("芥子科技");
    expect(loadCatalogsMock).toHaveBeenCalledTimes(1);
  });

  it("两个组件同时挂载只触发一次装载(in-flight 去重 + 结果共享)", async () => {
    loadCatalogsMock.mockResolvedValue(catalogPayload());

    render(
      <div>
        <CatalogProbe />
        <CatalogProbe />
      </div>
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("status").every((node) => node.textContent === "ready")).toBe(
        true
      );
    });
    expect(loadCatalogsMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("frames")).toHaveLength(2);
  });

  it("ready 之后再挂载新组件不重新请求(清单常驻内存)", async () => {
    loadCatalogsMock.mockResolvedValue(catalogPayload());
    const first = render(<CatalogProbe />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));

    first.unmount();
    render(<CatalogProbe />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));

    expect(loadCatalogsMock).toHaveBeenCalledTimes(1);
  });

  it("装载失败时暴露中文错误,reload 能真正重取", async () => {
    loadCatalogsMock.mockRejectedValueOnce(
      new Error("相框清单文件不存在(HTTP 404):/photo-watermark/frames.json")
    );
    render(<CatalogProbe />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
    expect(screen.getByTestId("frames").textContent).toBe("");

    loadCatalogsMock.mockResolvedValue(catalogPayload());
    await userEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(loadCatalogsMock).toHaveBeenCalledTimes(2);
  });

  it("清单为空数组时不报错,页面拿到空列表自行渲染空态", async () => {
    loadCatalogsMock.mockResolvedValue({
      frames: { version: 1, frames: [] },
      logos: { version: 1, logos: [] }
    });

    render(<CatalogProbe />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));

    expect(screen.getByTestId("frames").textContent).toBe("");
    expect(screen.getByTestId("status")).not.toHaveTextContent("error");
  });
});
