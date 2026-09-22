import { defineConfig } from "vitest/config";

// desktop 单元/组件测试配置(对齐 site:jsdom 默认环境 + tests/setup.ts 浏览器 API 垫片):
// - 组件用例(ErrorBoundary / Arco Result 等)跑 jsdom;纯逻辑用例(信封解包、config 解析)
//   可加 `// @vitest-environment node` docblock 提速;
// - electron 相关不在 vitest 启动;e2e 冒烟走 playwright.config.ts(tests/e2e/*.e2e.spec.ts),
//   文件名不匹配 include 模式,不会被 vitest 收录。
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"]
  }
});
