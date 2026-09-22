# apps/site/AGENTS.md

本文件面向 AI 编码助手,是 `apps/site`(Modern.js SSR 对外网站,匿名公开受众)的壳架构约束规范。
根 [AGENTS.md](../../AGENTS.md) 规则 18-21 在此细化;人读规范见 [docs/site.md](../../docs/site.md),壳建设方案与现状依据见 [docs/site-shell-plan.md](../../docs/site-shell-plan.md)。
本文件与根规则冲突时以本文件为准;§4/§5 的壳不变量属验收红线,拆除类改动一律拦截。

## 1. 分层与依赖方向

```
src/
  api/          # orval 生成物 + client.ts mutator + controllers.gen.ts(网络唯一入口)
  components/   # 壳组件(ErrorBoundary/SiteImage/PageLoading/SiteHeader/SiteFooter,无业务语义)
  config/       # 配置坑集中:env.ts / features.ts / site-theme.ts / tracking-events.ts / rum.ts / site.ts
  tracking/     # 埋点 facade(track/trackPageView)+ 可插拔 sink(console/RUM/HTTP)
  hooks/ store/ constants/ utils/   # 断点逻辑 / zustand 客户端状态 / 常量 / 工具
  routes/       # 页面与装配:*.data.ts loader + layout.tsx(稳定性/埋点唯一装配点)
```

- site **无 `core/` 目录**(与 h5 不同):`src/tracking` + `src/config` 即壳抽象层(职责对齐 h5 的 monitor/track),新增壳能力优先落这两层,不新开目录;
- 依赖方向只允许自上而下:

| 模块               | 允许依赖                                        | 禁止                                                          |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------- |
| routes             | components、hooks、store、api、config、tracking | 直接 import `@arms/rum-browser`、`web-vitals`(只经 §5 facade) |
| components / hooks | api、config、tracking、store                    | import `routes`                                               |
| store              | (zustand 客户端状态,叶子)                       | import `routes`、api(服务端数据不进 store,§2)                 |
| api                | tracking(失败上报)、config                      | import routes/components/hooks/store                          |
| tracking           | config                                          | import routes/components/hooks/store/api                      |
| config             | (叶子:env 校验/开关/主题/事件注册表)            | import src 其余模块                                           |

- **SDK 接触点收口**:`@arms/rum-browser` 只允许出现在 `src/config/rum.ts` 与 `src/tracking/sinks.ts`,`web-vitals` 只允许出现在 `src/tracking/index.ts`,且一律动态 import + `typeof window === "undefined"` 守卫(SSR 不执行)。

## 2. 数据流

- 服务端数据一律走路由 loader(`src/routes/*.data.ts` 具名导出 loader),组件 `useLoaderData` 读取(根规则 19);
- **loader 内禁止引用客户端状态;请求失败必须自捕获降级为 null**,页面端渲染降级文案,禁止让 SSR 页面因接口失败而 500;
- 服务端数据不进 zustand;客户端全局状态用 zustand(`src/store/`,每个领域一个 `useXxxStore`);
- 禁止 useEffect 手动拉接口;浏览器侧数据获取一律经 orval 生成的 controller 函数,`src/api/client.ts` mutator 是唯一网络入口。

## 3. UI 纪律

- Arco 一律按需引入:`modern.config.ts` 的 `source.transformImport` 双规则(组件 `style: true`、icon 单独规则不带样式;`camelToDashComponentName: false` 不可改),**禁止全量引入 `arco.css`**(562 kB CSS chunk 已移除,回归即红灯);
- 主题只改 `src/config/site-theme.ts`(经 ConfigProvider theme 生效),禁止在业务 CSS 硬编码 Arco token 兜底色值;
- 图片一律用 `components/site-image.tsx` 的 `SiteImage`(强制 width/height/loading/decoding,防 CLS),**禁止裸写 `<img>`**;
- 响应式断点统一 `src/hooks/use-breakpoint.ts` 的 `useIsMobile()`(< 768px;SSR 固定按桌面渲染,挂载后同步,保证 hydration 一致),禁止页面自写 matchMedia 或另立断点(根规则 20);
- 环境/双端判断统一 `typeof window === "undefined"`,禁止其他写法(根规则 18)。

## 4. 稳定性不变量

- **双层 ErrorBoundary 不得拆除或减层**(`routes/layout.tsx`:根层包整树、页面层包 Outlet,两级各自上报 `react_render_error`);稳定性装配点只在 layout,业务页面不得自行安装/拆卸错误边界或全局错误捕获;
- **`routes/loading.tsx` 路由级 loading 约定保留**(复用 `components/page-loading` 统一骨架屏),删除即路由级 Suspense 失去兜底;
- **`src/api/client.ts` 的韧性不得绕过**:超时 10s、幂等 GET 指数退避重试 1 次、最终失败上报 `api_error`;禁止另建 axios 实例、绕过 `customInstance` 直接 fetch、给写方法加自动重试。

## 5. 监控/埋点/开关

- 一切上报经 `src/tracking` facade(只暴露 `track`/`trackPageView` 两个方法,禁止扩 API 表面):env 门控,`RUM_ENDPOINT`/`RUM_PID` 任一缺失 → RUM 关,`TRACK_ENDPOINT` 缺失 → 埋点整体 no-op,dev 默认关闭(根规则 21);上报失败必须静默,禁止影响站点功能;
- **事件必须先登记 `src/config/tracking-events.ts`**(载荷类型 + `TrackingPayloadMap` + `TRACKING_EVENTS` 三处同步):`track` 的 event 参数类型收口在注册表键,未登记事件无法过编译,禁止散写字符串事件名;
- 禁止绕过 facade 手写上报(sendBeacon/XHR/fetch)或直接 new 监控 SDK 实例;sink 组合只在 `src/tracking/sinks.ts`(console/RUM/HTTP 三 sink),禁止新增第四通道,禁止事件队列/离线持久化/批量缓冲;
- web-vitals 指标由 `initTracking()` 统一注册(layout 装配),业务不得重复挂 `onCLS`/`onLCP` 等回调;
- env 与开关:新代码一律走 `src/config/env.ts` 的 `siteEnv` 单例与 `config/features.ts` 的 `readFeatureFlags`,禁止业务代码散读 `process.env` 或散判 env(浏览器 bundle 无 Node process;`RUM_*` 为构建期内联,必须保持按成员访问写法)。

## 6. 安全与文件纪律

- **生产 CSP meta 由构建注入**(`modern.config.ts` html.meta,仅 `NODE_ENV=production` 生效;`package.json` build 脚本已显式预置):生产构建必须经该脚本执行,否则 CSP meta 缺失;CSP 只在 `modern.config.ts` 修改,`RUM_ENDPOINT`/`TRACK_ENDPOINT` 的 origin 由构建期 env 自动并入 connect-src;nonce 化/收紧 unsafe-inline 另立项,业务代码不得依赖 unsafe-inline;
- **性能预算只改 `config/budgets.json`**(预算断言脚本消费):超预算先改预算文件并说明理由,禁止把阈值硬编码进脚本;构建分析走 `ANALYZE=true`(build:analyze),报告落 dist,不引入新分析器依赖;
- **生成物禁改**:`src/api/generated/**`、`src/api/controllers.gen.ts`;契约变更固定流程:改 `openapi/site.yaml` → `pnpm gen:api` → 补实现(根规则 1-3);
- **新增依赖(含 devDependencies)需总指挥评审**后进 `package.json`,禁止擅自 install 或改 lockfile;
- 富文本渲染先过 DOMPurify,**禁止 `dangerouslySetInnerHTML`**(根规则 21)。

## 7. 与根规则的关系

根 [AGENTS.md](../../AGENTS.md) 规则 18-21 在此本地化展开,未覆盖处以根规则为准;冲突以本文件为准。

| 根规则 | 主题                            | 本文件细化处 |
| ------ | ------------------------------- | ------------ |
| 18     | SSR 双端 baseURL/环境判断       | §2、§3       |
| 19     | loader 数据流/禁 useEffect 拉数 | §2           |
| 20     | 响应式双端适配                  | §3           |
| 21     | 富文本/CSP/RUM 门控             | §4、§5、§6   |
