import { defineConfig } from "vitest/config";

// miniapp 单测只覆盖纯逻辑(信封解包等),不渲染 Taro 小程序组件(小程序组件在 jsdom 不可渲染),
// 因此用 node 环境即可,无需 jsdom 与 setup 文件。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/api/generated/**", "src/api/controllers.gen.ts", "**/*.d.ts"],
      thresholds: {
        // 占坑期基线(只许调高;业务进来后评审调整,见 docs/miniapp-shell-plan.md §3 决策 6)
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
        // core 壳基础设施:零依赖自研,门槛最严
        "src/core/**": {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90
        }
      }
    }
  }
});
