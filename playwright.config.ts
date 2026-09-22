import { defineConfig, devices } from "@playwright/test";

// e2e 起独立端口的 server(18085)与 admin(18080)、site(18081)、h5(18082/18083 降级变体)。
const E2E_SERVER_PORT = 18085;
const E2E_SITE_PORT = 18081;
const E2E_H5_PORT = 18082;
// 降级变体:同一个 h5 dev 服务,H5_API_BASE 指向死端口,SSR loader 失败走降级文案。
const E2E_H5_FALLBACK_PORT = 18083;

export default defineConfig({
  testDir: "./tests/playwright",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:18080",
    trace: "on-first-retry"
  },
  webServer: [
    {
      // STORAGE_DRIVER=local 钉死本地存储,避免本地 .env.local(driver=cos)让 e2e 依赖外网
      // CSRF_ALLOWED_ORIGINS: e2e 的 admin 起在 127.0.0.1:18080,浏览器 Origin 不在服务端
      // 默认白名单(localhost:8081)里,须显式放行(见 docs/server.md "CSRF 与会话安全")。
      command: `rm -f /tmp/cms-e2e.db && SERVER_PORT=${E2E_SERVER_PORT} DATABASE_DSN=/tmp/cms-e2e.db SWAGGER_ENABLED=false STORAGE_DRIVER=local STORAGE_BASE_PATH=/tmp/cms-e2e-files CSRF_ALLOWED_ORIGINS=http://127.0.0.1:18080 go run ./cmd/server`,
      cwd: "./apps/server",
      url: `http://127.0.0.1:${E2E_SERVER_PORT}/api/admin/healthz`,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: `PORT=18080 API_PROXY_TARGET=http://127.0.0.1:${E2E_SERVER_PORT} pnpm --filter @monorepo-template/admin run dev`,
      url: "http://127.0.0.1:18080",
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      // site 的 SSR 数据不经过 dev 代理,直接按 SITE_API_BASE 打 Go server(见 docs/site.md)。
      command: `PORT=${E2E_SITE_PORT} API_PROXY_TARGET=http://127.0.0.1:${E2E_SERVER_PORT} SITE_API_BASE=http://127.0.0.1:${E2E_SERVER_PORT} pnpm --filter @monorepo-template/site run dev`,
      url: `http://127.0.0.1:${E2E_SITE_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      // h5 同 site:SSR 直连 Go server(H5_API_BASE),无浏览器代理需求(匿名只读)。
      command: `PORT=${E2E_H5_PORT} H5_API_BASE=http://127.0.0.1:${E2E_SERVER_PORT} pnpm --filter @monorepo-template/h5 run dev`,
      url: `http://127.0.0.1:${E2E_H5_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      // h5 降级变体:API 指向死端口,验证 SSR loader 失败后的降级文案(阶段 4 首组用例)。
      command: `PORT=${E2E_H5_FALLBACK_PORT} H5_API_BASE=http://127.0.0.1:9 pnpm --filter @monorepo-template/h5 run dev`,
      url: `http://127.0.0.1:${E2E_H5_FALLBACK_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ],
  projects: [
    {
      name: "chromium",
      testIgnore: /site-app\.spec\.ts|site-visual\.spec\.ts|h5-app\.spec\.ts|h5-fallback\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      // site 用例:baseURL 指向 site dev(18081),后端复用同一 e2e server(18085)。
      name: "site",
      testMatch: /site-app\.spec\.ts|site-visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${E2E_SITE_PORT}` }
    },
    {
      // h5 用例:移动视口(活动 H5 场景),baseURL 指向 h5 dev(18082)。
      name: "h5",
      testMatch: /h5-app\.spec\.ts/,
      use: { ...devices["Pixel 5"], baseURL: `http://127.0.0.1:${E2E_H5_PORT}` }
    },
    {
      // h5 降级变体:API 死端口,SSR 失败 → 降级文案(h5-fallback.spec.ts)。
      name: "h5-fallback",
      testMatch: /h5-fallback\.spec\.ts/,
      use: { ...devices["Pixel 5"], baseURL: `http://127.0.0.1:${E2E_H5_FALLBACK_PORT}` }
    }
  ]
});
