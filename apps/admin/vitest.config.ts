import { defineConfig } from "vitest/config";

// admin 单元/组件测试配置(docs/admin.md「测试」章节):
// 默认 jsdom 环境覆盖组件用例;纯逻辑用例用 `// @vitest-environment node` docblock 覆盖;
// globals 开启供 @testing-library/react 的自动 cleanup(全局 afterEach)生效。
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"]
  }
});
