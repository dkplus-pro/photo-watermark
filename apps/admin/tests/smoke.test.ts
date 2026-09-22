// 结构性回归守卫(纯文件断言,无需 DOM,用 node 环境)。
// 水印相框是纯静态站:本文件锁住「不回到 CMS」的几条硬约束。
// @vitest-environment node
import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

const read = (relative: string) => readFile(new URL(relative, import.meta.url), "utf8");

const packageJson = JSON.parse(await read("../package.json"));
const configSource = await read("../modern.config.ts");
const layoutSource = await read("../src/routes/layout.tsx");
const menuSource = await read("../src/config/menu.tsx");

test("admin app exposes static-site lifecycle scripts", () => {
  expect(packageJson.scripts.dev).toBe("modern dev");
  expect(packageJson.scripts.build).toBe("modern build");
  expect(packageJson.scripts["build:github-pages"]).toBe("modern build");
  expect(packageJson.scripts["deploy:github-pages"]).toBe("pnpm --workspace-root run build:pages");
  expect(packageJson.scripts.typecheck).toBe("tsc --noEmit");
  // 脱离契约链(D1):不再有 gen:api,也不再依赖 orval/axios/react-query。
  expect(packageJson.scripts["gen:api"]).toBeUndefined();
  expect(packageJson.devDependencies.orval).toBeUndefined();
  expect(packageJson.dependencies.axios).toBeUndefined();
  expect(packageJson.dependencies["@tanstack/react-query"]).toBeUndefined();
  for (const required of ["zustand", "ahooks", "lodash", "exifr", "piexifjs", "fflate"]) {
    expect(packageJson.dependencies[required], `${required} required`).toBeTruthy();
  }
});

test("basePath feeds both assetPrefix and router basename from one source (D11)", () => {
  expect(configSource).toMatch(/const basePath =/);
  expect(configSource).toMatch(/assetPrefix/);
  expect(configSource).toMatch(/__APP_BASE_PATH__/);
  expect(configSource).toMatch(/GITHUB_PAGES_BASE_PATH/);
  expect(configSource).toMatch(/GITHUB_REPOSITORY/);
  expect(configSource).toMatch(/outputStructure: "flat"/);
  expect(configSource).toMatch(/html: ""/);
  // 无后端:dev 代理与 API_PROXY_TARGET 必须消失。
  expect(configSource).not.toMatch(/proxy/);
  expect(configSource).not.toMatch(/API_PROXY_TARGET/);
  // 导出与预览用 Blob URL,CSP 的 img-src 必须放行 blob:。
  expect(configSource).toMatch(/img-src 'self' data: blob:/);
});

test("shell is anonymous: no auth, no query client, no server state", () => {
  expect(layoutSource).not.toMatch(/QueryClientProvider/);
  expect(layoutSource).not.toMatch(/useAuthStore/);
  expect(layoutSource).not.toMatch(/Navigate to="\/login"/);
  expect(layoutSource).toMatch(/ConfigProvider/);
  expect(layoutSource).toMatch(/ErrorBoundary/);
  // 移动端整壳适配(D12):窄屏用 Drawer 承载导航。
  expect(layoutSource).toMatch(/Drawer/);
});

test("sidebar declares only the watermark frame feature", () => {
  expect(menuSource).toMatch(/水印相框/);
  expect(menuSource).toMatch(/相框列表/);
  expect(menuSource).toMatch(/\/frames/);
  expect(menuSource).not.toMatch(/permission/);
  expect(menuSource).not.toMatch(/system|media|dashboard|login/i);
});

test("static asset URLs are always prefix-aware (D10)", async () => {
  const assetUrlSource = await read("../src/utils/asset-url.ts");
  expect(assetUrlSource).toMatch(/APP_BASENAME/);
  // 业务代码不得裸写 public 根路径。
  const shellSources = await Promise.all([
    layoutSource,
    menuSource,
    read("../src/routes/page.tsx"),
    read("../src/components/page-container.tsx")
  ]);
  for (const source of shellSources) {
    expect(source).not.toMatch(/["']\/(frames|logos)\.json["']/);
    expect(source).not.toMatch(/["']\/assets\//);
  }
});
