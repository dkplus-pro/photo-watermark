import { defineConfig } from "vitest/config";

// h5 单元测试配置(照抄 site,与 admin 同构):
// 默认 jsdom 环境覆盖组件用例;纯逻辑/SSR 分支用例用 `// @vitest-environment node` docblock 覆盖。
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/api/generated/**", "src/api/controllers.gen.ts", "**/*.d.ts"],
      thresholds: {
        // 全局起步门槛(只许调高,见 docs/h5-shell-plan.md §4)
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
        // core 壳能力层门槛
        "src/core/**": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80
        }
      }
    }
  }
});
