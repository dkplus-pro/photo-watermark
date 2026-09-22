// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// site client 的 SSR 分支(node 环境,无 window):baseURL 必须来自 SITE_API_BASE。
// axios 打 mock 桩,只断言 create 收到的配置(见 docs/site.md「测试」的 mock 边界)。
const h = vi.hoisted(() => ({ createSpy: vi.fn() }));

vi.mock("axios", () => ({
  default: {
    create: (config: unknown) => {
      h.createSpy(config);
      return {
        interceptors: { response: { use: () => undefined } },
        request: () => Promise.resolve({ data: null })
      };
    }
  }
}));

describe("client SSR baseURL(node 环境)", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete process.env.SITE_API_BASE;
  });

  it("未注入 SITE_API_BASE 时使用默认地址 127.0.0.1:8080", async () => {
    await import("../../src/api/client");
    expect(h.createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://127.0.0.1:8080" })
    );
  });

  it("SITE_API_BASE 注入时覆盖 baseURL", async () => {
    process.env.SITE_API_BASE = "http://10.1.2.3:9000";
    await import("../../src/api/client");
    expect(h.createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://10.1.2.3:9000" })
    );
  });
});
