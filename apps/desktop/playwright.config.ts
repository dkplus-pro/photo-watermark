import { defineConfig } from "@playwright/test";

// desktop e2e 冒烟(playwright `_electron.launch` 打构建产物起真实窗口,方案见
// docs/desktop-shell-plan.md §0/§4 阶段 3)。独立配置,暂不挂进根 test:e2e(收口卡接入);
// 用例自带 out/ 产物存在性检查,无产物时整文件 skip,不阻塞无构建环境。
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 主进程有单实例锁(src/main/index.ts),Electron 实例只能串行起。
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: "list"
});
