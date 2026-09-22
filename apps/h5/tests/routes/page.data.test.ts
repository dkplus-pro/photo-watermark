// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// 路由 loader 冒烟:服务端请求失败必须降级为 null,不阻断 SSR 渲染(照抄 site loader 用例)。
const ping = vi.hoisted(() => vi.fn());

vi.mock("../../src/api/controllers.gen", () => ({
  H5Controller: { ping }
}));

describe("page.data loader(首页)", () => {
  beforeEach(() => {
    ping.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("请求成功返回 ping 数据", async () => {
    ping.mockResolvedValue({ message: "pong from h5 api" });
    const { loader } = await import("../../src/routes/page.data");
    await expect(loader()).resolves.toEqual({ message: "pong from h5 api" });
  });

  it("请求失败降级返回 null,不向上抛", async () => {
    ping.mockRejectedValue(new Error("network down"));
    const { loader } = await import("../../src/routes/page.data");
    await expect(loader()).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});
