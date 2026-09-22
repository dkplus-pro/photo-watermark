import { beforeEach, describe, expect, it, vi } from "vitest";

// site client 的幂等重试语义(阶段 5.2 验收 + 任务卡 6.1,jsdom 浏览器分支):
// 超时预算 10s;GET 瞬时失败(网络错误/5xx)指数退避重试 1 次;4xx/写操作不重试;
// 非 AxiosError 原样抛出;最终失败经 tracking facade 上报 api_error。
// axios 打 mock 桩(与 client.browser.test.ts 同边界),额外补 isAxiosError/AxiosError
// 导出供 client 的错误判定使用;tracking facade 以 vi.mock 替身断言上报调用。
const h = vi.hoisted(() => {
  const state: {
    createSpy: ReturnType<typeof vi.fn>;
    requestSpy: ReturnType<typeof vi.fn>;
    track: ReturnType<typeof vi.fn>;
  } = { createSpy: vi.fn(), requestSpy: vi.fn(), track: vi.fn() };
  return state;
});

vi.mock("axios", () => ({
  default: {
    create: (config: unknown) => {
      h.createSpy(config);
      return {
        interceptors: { response: { use: () => undefined } },
        request: h.requestSpy
      };
    }
  },
  isAxiosError: (error: unknown): boolean =>
    typeof error === "object" && error !== null && (error as { isAxiosError?: boolean }).isAxiosError === true,
  AxiosError: class AxiosErrorStub extends Error {}
}));

vi.mock("../../src/tracking", () => ({ track: h.track }));

// 构造 AxiosError 形状的替身:status 传 undefined 模拟无响应(网络错误/超时)。
function axiosErrorLike(status?: number) {
  return {
    isAxiosError: true,
    config: { url: "/api/site/site-info" },
    response: status === undefined ? undefined : { status }
  };
}

describe("customInstance 幂等重试(浏览器分支)", () => {
  beforeEach(() => {
    h.requestSpy.mockReset();
    h.createSpy.mockClear();
    h.track.mockClear();
  });

  it("create 配置超时预算 10s", async () => {
    await import("../../src/api/client");
    expect(h.createSpy).toHaveBeenCalledWith(expect.objectContaining({ timeout: 10_000 }));
  });

  it("GET 瞬时失败(5xx)退避重试 1 次后成功", async () => {
    const { customInstance } = await import("../../src/api/client");
    h.requestSpy.mockRejectedValueOnce(axiosErrorLike(500)).mockResolvedValueOnce({ data: { ok: 1 } });
    await expect(customInstance({ url: "/api/site/site-info", method: "GET" })).resolves.toEqual({
      ok: 1
    });
    expect(h.requestSpy).toHaveBeenCalledTimes(2);
    expect(h.track).not.toHaveBeenCalled();
  });

  it("GET 4xx 业务错误不重试,最终失败上报 api_error", async () => {
    const { customInstance } = await import("../../src/api/client");
    h.requestSpy.mockRejectedValue(axiosErrorLike(404));
    await expect(customInstance({ url: "/api/site/site-info", method: "GET" })).rejects.toMatchObject({
      response: { status: 404 }
    });
    expect(h.requestSpy).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(h.track).toHaveBeenCalledWith(
        "api_error",
        expect.objectContaining({ endpoint: "/api/site/site-info", status: 404 })
      );
    });
  });

  it("GET 网络错误(无响应)重试后仍失败,上报兜底文案与 status 0", async () => {
    const { customInstance } = await import("../../src/api/client");
    h.requestSpy.mockRejectedValue(axiosErrorLike(undefined));
    await expect(customInstance({ url: "/api/site/site-info", method: "GET" })).rejects.toBeDefined();
    expect(h.requestSpy).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => {
      expect(h.track).toHaveBeenCalledWith(
        "api_error",
        expect.objectContaining({ message: "请求失败(无响应)", status: 0 })
      );
    });
  });

  it("POST 写操作失败不重试(防重复提交),仍上报 api_error", async () => {
    const { customInstance } = await import("../../src/api/client");
    h.requestSpy.mockRejectedValue(axiosErrorLike(500));
    await expect(customInstance({ url: "/api/site/content", method: "POST" })).rejects.toBeDefined();
    expect(h.requestSpy).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(h.track).toHaveBeenCalledWith("api_error", expect.objectContaining({ status: 500 }));
    });
  });

  it("非 AxiosError 异常原样抛出,不重试也不上报", async () => {
    const { customInstance } = await import("../../src/api/client");
    const plain = new Error("plain failure");
    h.requestSpy.mockRejectedValue(plain);
    await expect(customInstance({ url: "/api/site/site-info", method: "GET" })).rejects.toBe(plain);
    expect(h.requestSpy).toHaveBeenCalledTimes(1);
    expect(h.track).not.toHaveBeenCalled();
  });
});
