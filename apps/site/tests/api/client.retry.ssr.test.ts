// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// site client 的 SSR 重试分支(node 环境,无 window,与 client.retry.test.ts 同一套 axios 桩):
// 幂等 GET 重试语义在 SSR 同样生效,但最终失败不上报 tracking(SSR 侧无浏览器 facade,
// isServer 守卫短路,失败已走 console.error)。
const h = vi.hoisted(() => {
  const state: {
    requestSpy: ReturnType<typeof vi.fn>;
    track: ReturnType<typeof vi.fn>;
  } = { requestSpy: vi.fn(), track: vi.fn() };
  return state;
});

vi.mock("axios", () => ({
  default: {
    create: () => ({
      interceptors: { response: { use: () => undefined } },
      request: h.requestSpy
    })
  },
  isAxiosError: (error: unknown): boolean =>
    typeof error === "object" && error !== null && (error as { isAxiosError?: boolean }).isAxiosError === true,
  AxiosError: class AxiosErrorStub extends Error {}
}));

vi.mock("../../src/tracking", () => ({ track: h.track }));

describe("customInstance SSR 分支(node 环境)", () => {
  beforeEach(() => {
    h.requestSpy.mockReset();
    h.track.mockClear();
  });

  it("GET 瞬时失败重试 1 次后成功(SSR 同样幂等重试)", async () => {
    const { customInstance } = await import("../../src/api/client");
    h.requestSpy
      .mockRejectedValueOnce({ isAxiosError: true, config: { url: "/api/site/site-info" }, response: { status: 502 } })
      .mockResolvedValueOnce({ data: { siteName: "站" } });
    await expect(customInstance({ url: "/api/site/site-info", method: "GET" })).resolves.toEqual({
      siteName: "站"
    });
    expect(h.requestSpy).toHaveBeenCalledTimes(2);
  });

  it("最终失败不上报 tracking(SSR 无 facade,isServer 守卫短路)", async () => {
    const { customInstance } = await import("../../src/api/client");
    h.requestSpy.mockRejectedValue({
      isAxiosError: true,
      config: { url: "/api/site/site-info" },
      response: { status: 500 }
    });
    await expect(customInstance({ url: "/api/site/site-info", method: "GET" })).rejects.toBeDefined();
    expect(h.requestSpy).toHaveBeenCalledTimes(2);
    // 动态上报是异步的,等一拍确认不会出现迟到调用。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.track).not.toHaveBeenCalled();
  });
});
