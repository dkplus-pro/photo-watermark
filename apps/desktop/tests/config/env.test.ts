// @vitest-environment node
import { describe, expect, it } from "vitest";

import { loadRendererEnv } from "../../src/renderer/src/config";

// 显式构造完整 ImportMetaEnv:vite/client 的 BASE_URL/MODE/PROD/SSR 为必填槽位,
// 用例只关心 VITE_* 与 DEV 的注入值,其余填测试环境固定值。
function makeEnv(partial: Partial<ImportMetaEnv>): ImportMetaEnv {
  return {
    BASE_URL: "/",
    MODE: "test",
    PROD: false,
    SSR: false,
    VITE_API_BASE: partial.VITE_API_BASE,
    VITE_TRACK_DISABLED: partial.VITE_TRACK_DISABLED,
    DEV: partial.DEV ?? false
  };
}

// 渲染层配置坑解析(src/renderer/src/config,纪律同 site):
// VITE_* 读取与默认值兜底。loadRendererEnv 为纯函数,env 由用例显式注入,不走单例。
describe("loadRendererEnv", () => {
  it("全缺省时返回默认值(apiBase 空串、埋点开启、非 dev)", () => {
    expect(loadRendererEnv(makeEnv({}))).toEqual({
      apiBase: "",
      trackDisabled: false,
      dev: false
    });
  });

  it("显式配置逐项透传(VITE_API_BASE / VITE_TRACK_DISABLED)", () => {
    expect(
      loadRendererEnv(
        makeEnv({
          VITE_API_BASE: "https://api.example.com",
          VITE_TRACK_DISABLED: "true"
        })
      )
    ).toEqual({
      apiBase: "https://api.example.com",
      trackDisabled: true,
      dev: false
    });
  });

  it("VITE_TRACK_DISABLED 仅严格等于 'true' 才关闭('false'/空串/缺省均视为开启)", () => {
    expect(loadRendererEnv(makeEnv({ VITE_TRACK_DISABLED: "false" })).trackDisabled).toBe(false);
    expect(loadRendererEnv(makeEnv({ VITE_TRACK_DISABLED: "" })).trackDisabled).toBe(false);
    expect(loadRendererEnv(makeEnv({})).trackDisabled).toBe(false);
  });

  it("dev 标记透传 vite 注入的 DEV 槽位(dev 构建下埋点默认关的依据)", () => {
    expect(loadRendererEnv(makeEnv({ DEV: true })).dev).toBe(true);
    expect(loadRendererEnv(makeEnv({ DEV: false })).dev).toBe(false);
  });
});
