import { appTools, defineConfig } from "@modern-js/app-tools";
import pxToViewport from "postcss-px-to-viewport-8-plugin";

// h5 默认 18082(site 8082 / admin 8081 / server 8080 已占用,见 docs/monorepo-expansion-plan.md 阶段 3)。
const devServerPort = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 18082;

// dev 代理 /api → Go server(h5 受众链,18085;e2e 起独立端口的服务端时用 API_PROXY_TARGET 覆盖)。
// 契约路径字面带 /api/h5 前缀,开发态原样透传(见 docs/multi-audience-contracts.md)。
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:18085";

// 生产构建注入 CSP meta(XSS 防御,仅生产注入:dev 的 HMR/内联脚本会被 CSP 破坏,
// 与 site 同策略)。SSR 会内联 loader 数据 script,严格 'self' 会拦内联 script,起步
// 放开 'unsafe-inline';TODO:nonce 化后收紧。托管层响应头 CSP 为权威配置。
const productionCSP = [
  "script-src 'self' 'unsafe-inline'",
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

// 移动端 viewport:Modern.js 默认也注入一版(含 viewport-fit=cover),这里显式钉住 h5 口径
// (禁缩放 + 覆盖刘海安全区,PageShell 的 env(safe-area-inset-*) 依赖 viewport-fit=cover),
// 避免框架默认值变化影响活动页表现。
const viewportMeta = {
  viewport:
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
};

// arco-mobile 按需引入:Rsbuild transformImport 等价 babel-plugin-import,把
// `import { Button } from "@arco-design/mobile-react"` 改写成直连子模块
// `.../esm/button` + 样式 `.../esm/button/style/css`,整包不进 bundle(方案 §1 决策 4)。
// - libraryDirectory 用 esm:Modern.js SSR 会把 node_modules 一并打进 dist/bundles,不存在
//   arco 文档里「SSR 需改用 cjs」的场景;
// - style 取 css(arco 预编译产物)而非 less:arco 样式是 rem 制式(@base-font-size: 50),
//   px→vw 转换不到它,用 css 可免装 less 工具链(arco 的 less 还需 javascriptEnabled 支持内联 mixin);
// - camelToDashComponentName / transformToDefaultImport 显式写出(与默认值一致),对齐 arco-mobile
//   的 kebab-case 目录(context-provider 等)+ default export 结构(与 site 的 web-react 相反,
//   后者的 es 目录是 PascalCase 且必须关掉这个开关)。
const arcoMobileTransformImport = {
  libraryName: "@arco-design/mobile-react",
  libraryDirectory: "esm",
  style: "css",
  camelToDashComponentName: true,
  transformToDefaultImport: true
};

// 设计稿宽 375 的 px→vw 适配(方案 §3「移动适配」):不配 include/exclude,node_modules 里的样式
// (含 arco 组件样式)同样进入转换范围;minPixelValue 保持默认 1,即 1px 及以下(1px 边框)保留 px。
// arco 样式自身的 1PX 边框用大写单位,天然不参与转换。
// 注:arco 组件靠 rem 自适应,需要根布局按屏宽设置 root font-size(flexible),归阶段 3 收口装配。
const pxToViewportPlugin = pxToViewport({
  viewportWidth: 375,
  unitPrecision: 5,
  viewportUnit: "vw",
  fontViewportUnit: "vw",
  minPixelValue: 1
});

// RUM/埋点配置构建期内联(照抄 apps/site/modern.config.ts 的 source.define 模式):
// 客户端 bundle 不存在 Node 的 process,裸 process.env 引用会 ReferenceError(实测踩过),
// 因此把 src/config/env.ts 读取的 RUM_*/TRACK_ENDPOINT/H5_*_SAMPLE_RATE 显式内联为字面量;
// 未配置时内联为空串,src/config/feature.ts 判空即不启用(dev 默认关闭)。
// 构建期内联意味着部署时需在构建(CI)阶段注入,而非仅运行时(H5_API_BASE 仅 SSR 使用,不内联)。
const envDefine = {
  "process.env.RUM_PID": JSON.stringify(process.env.RUM_PID ?? ""),
  "process.env.RUM_ENDPOINT": JSON.stringify(process.env.RUM_ENDPOINT ?? ""),
  "process.env.TRACK_ENDPOINT": JSON.stringify(process.env.TRACK_ENDPOINT ?? ""),
  "process.env.H5_MONITOR_SAMPLE_RATE": JSON.stringify(process.env.H5_MONITOR_SAMPLE_RATE ?? ""),
  "process.env.H5_TRACK_SAMPLE_RATE": JSON.stringify(process.env.H5_TRACK_SAMPLE_RATE ?? "")
};

export default defineConfig({
  source: {
    define: envDefine,
    transformImport: [arcoMobileTransformImport]
  },
  tools: {
    postcss: (_config, { addPlugins }) => {
      addPlugins([pxToViewportPlugin]);
    }
  },
  html: {
    title: "CMS Template H5",
    meta: {
      ...viewportMeta,
      ...(process.env.NODE_ENV === "production" ? productionCSPMeta : {})
    }
  },
  server: {
    port: devServerPort,
    // SSR 开启后路由模块的 loader(page.data.ts)在服务端执行,数据随 HTML 下发,
    // 客户端 hydration 复用(与 site 同范式,见 docs/site.md「SSR 注意事项」)。
    ssr: true
  },
  dev: {
    server: {
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true
        }
      }
    }
  },
  plugins: [appTools()]
});
