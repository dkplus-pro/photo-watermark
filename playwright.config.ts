import { defineConfig, devices } from "@playwright/test";

// e2e 起独立端口的 server(18085)与 admin(18080)、site(18081)、h5(18082/18083 降级变体)。
const E2E_ADMIN_PORT = 18080;
const E2E_SERVER_PORT = 18085;
const E2E_SITE_PORT = 18081;
const E2E_H5_PORT = 18082;
// 降级变体:同一个 h5 dev 服务,H5_API_BASE 指向死端口,SSR loader 失败走降级文案。
const E2E_H5_FALLBACK_PORT = 18083;

/**
 * 本次运行显式选了哪些 project(--project);返回 null 表示没选(全量跑)。
 *
 * Playwright 1.61 的 webServer 只有全局一档(`TestProject` 类型里没有 per-project webServer,
 * 已在本机 node_modules 的 playwright/types/test.d.ts 与 configLoader 里核对过),所以「哪个
 * project 起哪些 server」只能在这里自己筛。
 */
function parseRequestedProjects(argv: readonly string[]): Set<string> | null {
  const names = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument.startsWith("--project=")) {
      names.add(argument.slice("--project=".length));
    } else if (argument === "--project") {
      const next = argv[index + 1];
      if (next) names.add(next);
    }
  }
  return names.size > 0 ? names : null;
}

const requestedProjects = parseRequestedProjects(process.argv);

// 认不全的调用形态一律按「全量跑」处理(起全部 server):多起一个服务的代价远小于少起一个。
function serves(...projectNames: string[]): boolean {
  return requestedProjects === null || projectNames.some((name) => requestedProjects?.has(name));
}

// admin 受众依赖:admin 本身 + 历史上就指向 18080 的 chromium project(它不匹配任何用例,
// 但依赖口径保持原样,免得哪天往 chromium 里加 CMS 用便时发现服务没起)。
const goApiServer = {
  // STORAGE_DRIVER=local 钉死本地存储,避免本地 .env.local(driver=cos)让 e2e 依赖外网
  // CSRF_ALLOWED_ORIGINS: e2e 的 admin 起在 127.0.0.1:18080,浏览器 Origin 不在服务端
  // 默认白名单(localhost:8081)里,须显式放行(见 docs/server.md "CSRF 与会话安全")。
  command: `rm -f /tmp/cms-e2e.db && SERVER_PORT=${E2E_SERVER_PORT} DATABASE_DSN=/tmp/cms-e2e.db SWAGGER_ENABLED=false STORAGE_DRIVER=local STORAGE_BASE_PATH=/tmp/cms-e2e-files CSRF_ALLOWED_ORIGINS=http://127.0.0.1:18080 go run ./cmd/server`,
  cwd: "./apps/server",
  url: `http://127.0.0.1:${E2E_SERVER_PORT}/api/admin/healthz`,
  reuseExistingServer: false,
  timeout: 120_000
};

// admin 已是纯静态「水印相框」工具:无服务端、无鉴权,原先的 API_PROXY_TARGET 是死配置,已删。
const adminDevServer = {
  command: `PORT=${E2E_ADMIN_PORT} pnpm --filter @monorepo-template/admin run dev`,
  url: `http://127.0.0.1:${E2E_ADMIN_PORT}`,
  reuseExistingServer: false,
  timeout: 120_000
};

// site 的 SSR 数据不经过 dev 代理,直接按 SITE_API_BASE 打 Go server(见 docs/site.md)。
const siteDevServer = {
  command: `PORT=${E2E_SITE_PORT} API_PROXY_TARGET=http://127.0.0.1:${E2E_SERVER_PORT} SITE_API_BASE=http://127.0.0.1:${E2E_SERVER_PORT} pnpm --filter @monorepo-template/site run dev`,
  url: `http://127.0.0.1:${E2E_SITE_PORT}`,
  reuseExistingServer: false,
  timeout: 120_000
};

// h5 同 site:SSR 直连 Go server(H5_API_BASE),无浏览器代理需求(匿名只读)。
const h5DevServer = {
  command: `PORT=${E2E_H5_PORT} H5_API_BASE=http://127.0.0.1:${E2E_SERVER_PORT} pnpm --filter @monorepo-template/h5 run dev`,
  url: `http://127.0.0.1:${E2E_H5_PORT}`,
  reuseExistingServer: false,
  timeout: 120_000
};

// h5 降级变体:API 指向死端口,验证 SSR loader 失败后的降级文案(阶段 4 首组用例)。
const h5FallbackDevServer = {
  command: `PORT=${E2E_H5_FALLBACK_PORT} H5_API_BASE=http://127.0.0.1:9 pnpm --filter @monorepo-template/h5 run dev`,
  url: `http://127.0.0.1:${E2E_H5_FALLBACK_PORT}`,
  reuseExistingServer: false,
  timeout: 120_000
};

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
    baseURL: `http://127.0.0.1:${E2E_ADMIN_PORT}`,
    trace: "on-first-retry"
  },
  webServer: [
    ...(serves("chromium", "site", "h5", "h5-fallback") ? [goApiServer] : []),
    ...(serves("chromium", "admin") ? [adminDevServer] : []),
    ...(serves("site") ? [siteDevServer] : []),
    ...(serves("h5") ? [h5DevServer] : []),
    ...(serves("h5-fallback") ? [h5FallbackDevServer] : [])
  ],
  projects: [
    {
      name: "chromium",
      testIgnore:
        /site-app\.spec\.ts|site-visual\.spec\.ts|h5-app\.spec\.ts|h5-fallback\.spec\.ts|watermark-frame\.spec\.ts/,
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
    },
    {
      // admin「水印相框」(docs/watermark-frame-plan.md §8):黄金路径「选图 → 导出 → 拿到 zip」,
      // 桌面与移动两轮都在 watermark-frame.spec.ts 里,视口切换由 spec 内的 test.use 完成 ——
      // 这样门禁命令保持 `playwright test --project=admin` 一条,不必拆成两个 project。
      // 该 project 只起 admin 自己的 dev server(见上面的 serves())。
      name: "admin",
      testMatch: /watermark-frame\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${E2E_ADMIN_PORT}` }
    }
  ]
});
