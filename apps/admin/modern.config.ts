import { appTools, defineConfig } from "@modern-js/app-tools";

// admin 默认 8081,8080 留给 Go server(PORT 仍可覆盖,e2e 用它换端口)。
const devServerPort = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8081;

// 代理目标可被环境变量覆盖(e2e 起独立端口的服务端时使用)。
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8080";

// 生产静态资源前缀:后台网页挂在 /admin 下(见 docs/mvp-plan.md 阶段 8);
// GitHub Pages 演示部署以仓库 basePath 优先(GITHUB_PAGES_BASE_PATH 显式传值 > 自动推断)。
const githubPagesBasePath = normalizeGitHubPagesBasePath(
  process.env.GITHUB_PAGES_BASE_PATH ?? inferGitHubPagesBasePath()
);
const assetPrefix = githubPagesBasePath ?? process.env.ADMIN_ASSET_PREFIX ?? "/admin/";

function inferGitHubPagesBasePath() {
  if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_REPOSITORY) {
    return undefined;
  }

  const repositoryName = process.env.GITHUB_REPOSITORY.split("/").pop();
  return repositoryName ? `/${repositoryName}/` : undefined;
}

function normalizeGitHubPagesBasePath(basePath?: string) {
  const trimmedBasePath = basePath?.trim();
  if (!trimmedBasePath || trimmedBasePath === "/") {
    return undefined;
  }

  return `/${trimmedBasePath.replace(/^\/+|\/+$/g, "")}/`;
}

// 生产构建注入 CSP meta(XSS 防御,见 docs/admin-enhancement-plan.md 阶段 10)。
// 仅生产注入:dev 的 HMR/内联脚本会被 CSP 破坏;Arco 大量内联 style,style-src 需
// 'unsafe-inline';媒体 CDN 走 https:。托管层(nginx/Pages)响应头 CSP 为权威配置,
// meta 为兜底。
const productionCSP = [
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'"
].join("; ");

const productionCSPMeta = {
  "Content-Security-Policy": {
    "http-equiv": "Content-Security-Policy",
    content: productionCSP
  }
};

export default defineConfig({
  html: {
    outputStructure: "flat",
    title: "Monorepo Template admin",
    ...(process.env.NODE_ENV === "production" ? { meta: productionCSPMeta } : {})
  },
  output: {
    distPath: {
      html: ""
    },
    assetPrefix
  },
  ...(devServerPort ? { server: { port: devServerPort } } : {}),
  dev: {
    server: {
      proxy: {
        // 契约路径已字面带 /api/admin、/api/site 前缀,开发态原样透传到 Go server(见 docs/mvp-plan.md 阶段 8)。
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true
        }
      }
    }
  },
  plugins: [appTools()]
});
