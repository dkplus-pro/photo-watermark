import { appTools, defineConfig } from "@modern-js/app-tools";

// 水印相框是纯静态站点:无后端、无 API 代理,dev 端口仍可被 PORT 覆盖(e2e 用)。
const devServerPort = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8081;

// basePath 单一事实源(D11):同一变量同时喂给资源前缀 assetPrefix 与路由 basename,
// 两者不一致会让 GitHub Pages 子路径部署白屏。
// 优先级:显式 GITHUB_PAGES_BASE_PATH > Actions 仓库名推断 > ADMIN_BASE_PATH > 根路径。
const basePath =
  normalizeBasePath(
    process.env.GITHUB_PAGES_BASE_PATH ?? inferGitHubPagesBasePath() ?? process.env.ADMIN_BASE_PATH
  ) ?? "/";

const assetPrefix = basePath === "/" ? "/" : `${basePath}/`;

function inferGitHubPagesBasePath() {
  if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_REPOSITORY) {
    return undefined;
  }

  const repositoryName = process.env.GITHUB_REPOSITORY.split("/").pop();
  return repositoryName ? `/${repositoryName}/` : undefined;
}

function normalizeBasePath(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "/") {
    return undefined;
  }

  return `/${trimmed.replace(/^\/+|\/+$/gu, "")}`;
}

// 生产构建注入 CSP meta。图片预览用 Blob URL、导出用 anchor 下载,故 img-src 需 blob:;
// Worker 与静态资源全部同源,不放通配。dev 不注入(HMR 内联脚本会被破坏)。
const productionCSP = [
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
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
    title: "水印相框",
    ...(process.env.NODE_ENV === "production" ? { meta: productionCSPMeta } : {})
  },
  output: {
    distPath: {
      html: ""
    },
    assetPrefix
  },
  source: {
    define: {
      __APP_BASE_PATH__: JSON.stringify(basePath)
    }
  },
  ...(devServerPort ? { server: { port: devServerPort } } : {}),
  plugins: [appTools()]
});
