import { defineConfig } from "vitest/config";

// js-bridge 是纯协议包:node 环境即可,window 依赖一律经 globalThis stub 注入
// (见 tests/adapter.test.ts、tests/global.test.ts),不引入 jsdom、无 setup 文件。
// 覆盖率门槛对齐仓库 core 纪律(apps/miniapp 的 src/core/** 为 90):本包整体即 core 级。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["**/*.d.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90
      }
    }
  }
});
