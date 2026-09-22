import { defineConfig } from "vitest/config";

// site 单元/组件测试配置(docs/site.md「测试」章节,与 admin 同构):
// 默认 jsdom 环境覆盖组件用例;纯逻辑/SSR 分支用例用 `// @vitest-environment node` docblock 覆盖。
// 覆盖率门禁(docs/site-shell-plan.md 阶段 6.1):v8 provider,只统计 src(排除生成物),
// 全局阈值 80% 起步,阈值只许调高。enabled 常开:pnpm 11 会把 `test -- --coverage` 的
// `--` 原样透传,vitest 对 `--` 之后的参数全部忽略,CLI 旗标不可靠,门禁必须在配置层兜底。
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "src/api/generated/**",
        "src/api/controllers.gen.ts",
        "**/*.d.ts",
        "**/*.css",
        "**/.gitkeep"
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80
      }
    }
  }
});
