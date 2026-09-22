import { defineConfig } from "vitest/config";

// admin 单元/组件测试配置(测试纪律见 apps/admin/AGENTS.md):
// 默认 jsdom 环境覆盖组件用例;纯逻辑用例用 `// @vitest-environment node` docblock 覆盖;
// globals 开启供 @testing-library/react 的自动 cleanup(全局 afterEach)生效。
export default defineConfig({
  // src/constants 求值即需要 basePath,构建期由 modern.config.ts 的 source.define 内联,
  // 测试基座必须同步注入,否则任何 import constants 的用例都会 ReferenceError。
  define: { __APP_BASE_PATH__: JSON.stringify("/") },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"]
  }
});
