import { beforeEach, describe, expect, it, vi } from "vitest";

// site client 的浏览器分支(jsdom 环境):同源相对路径(baseURL 空串)+ 信封解包 + 错误提示。
// axios 打 mock 桩,捕获 create 配置与响应拦截器(见 docs/site.md「测试」的 mock 边界)。
const h = vi.hoisted(() => {
  const state: {
    createSpy: ReturnType<typeof vi.fn>;
    requestSpy: ReturnType<typeof vi.fn>;
    fulfilled?: (response: unknown) => unknown;
    rejected?: (error: unknown) => unknown;
  } = {
    createSpy: vi.fn(),
    requestSpy: vi.fn(),
    fulfilled: undefined,
    rejected: undefined
  };
  return state;
});

vi.mock("axios", () => ({
  default: {
    create: (config: unknown) => {
      h.createSpy(config);
      return {
        interceptors: {
          response: {
            use: (fulfilled: typeof h.fulfilled, rejected: typeof h.rejected) => {
              h.fulfilled = fulfilled;
              h.rejected = rejected;
            }
          }
        },
        request: h.requestSpy
      };
    }
  }
}));

describe("client 浏览器分支(jsdom 环境)", () => {
  beforeEach(() => {
    h.requestSpy.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("浏览器端 baseURL 为空串(同源相对路径)", async () => {
    await import("../../src/api/client");
    expect(h.createSpy).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "" }));
  });

  it("customInstance 返回解包后的 response.data", async () => {
    const { customInstance } = await import("../../src/api/client");
    h.requestSpy.mockResolvedValue({ data: { id: 1 } });
    await expect(customInstance({ url: "/api/site/site-info", method: "GET" })).resolves.toEqual({
      id: 1
    });
  });

  it("信封响应统一解包:interceptor 把 data 字段提出来", async () => {
    await import("../../src/api/client");
    const response = { data: { code: 200, message: "ok", data: { siteName: "站" } } };
    expect(h.fulfilled?.(response)).toEqual({ data: { siteName: "站" } });
  });

  it("非信封响应原样透传", async () => {
    await import("../../src/api/client");
    const response = { data: [1, 2, 3] };
    expect(h.fulfilled?.(response)).toEqual({ data: [1, 2, 3] });
  });

  it("错误响应:console 记录 message 并继续 reject", async () => {
    await import("../../src/api/client");
    const error = { response: { status: 500, data: { message: "服务端错误" } } };
    await expect(h.rejected?.(error)).rejects.toEqual(error);
    expect(console.error).toHaveBeenCalledWith("服务端错误");
  });

  it("错误响应缺 message 字段时输出兜底文案", async () => {
    await import("../../src/api/client");
    const error = { response: { status: 404, data: {} } };
    await expect(h.rejected?.(error)).rejects.toEqual(error);
    expect(console.error).toHaveBeenCalledWith("请求失败(404)");
  });
});
