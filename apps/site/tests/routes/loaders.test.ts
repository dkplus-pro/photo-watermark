// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// 路由 loader:服务端请求失败必须降级为 null,不阻断 SSR 渲染(docs/site.md「数据加载」)。
const getSiteInfo = vi.hoisted(() => vi.fn());

vi.mock("../../src/api/controllers.gen", () => ({
  SiteController: { getSiteInfo }
}));

describe("layout.data loader", () => {
  beforeEach(() => {
    getSiteInfo.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("请求成功返回站点信息", async () => {
    getSiteInfo.mockResolvedValue({ siteName: "测试站", logoUrl: "" });
    const { loader } = await import("../../src/routes/layout.data");
    await expect(loader()).resolves.toEqual({ siteName: "测试站", logoUrl: "" });
  });

  it("请求失败降级返回 null,不向上抛", async () => {
    getSiteInfo.mockRejectedValue(new Error("network down"));
    const { loader } = await import("../../src/routes/layout.data");
    await expect(loader()).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("page.data loader(首页)", () => {
  beforeEach(() => {
    getSiteInfo.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("请求失败降级返回 null,不向上抛", async () => {
    getSiteInfo.mockRejectedValue(new Error("network down"));
    const { loader } = await import("../../src/routes/page.data");
    await expect(loader()).resolves.toBeNull();
  });
});
