# apps/h5/AGENTS.md

本文件面向 AI 编码助手,是 `apps/h5`(Modern.js SSR 活动 H5,匿名公开受众)的架构约束规范。
根 [AGENTS.md](../../AGENTS.md) 规则 22-25 在此细化;壳建设方案与现状依据见 [docs/h5-shell-plan.md](../../docs/h5-shell-plan.md)。
本文件与根规则冲突时以本文件为准;违反分层依赖方向的修改会被评审与守护手段拦截。

## 1. 分层与依赖方向

```
src/
  api/          # orval 生成物 + client.ts mutator + controllers.gen.ts(网络唯一入口)
  component/    # 壳封装组件(PageShell/ShareHeader/ErrorView,无业务语义)
  config/       # 配置坑集中:env.ts(类型化读取) + feature.ts(开关) + share.ts(分享/OG)
  core/         # 壳能力层(本方案核心):monitor / track / stability / perf
  consts/ hooks/ store/   # 常量 / 组合式逻辑 / zustand 客户端状态
  routes/       # 页面:只做数据编排(loader + useLoaderData)
```

**依赖方向硬规则**:`routes → {component, hooks, store, api, core}`;`core → config` 允许;**`core` 禁止 import `routes`/`store`**;业务代码(routes/component)**只允许经 `core/monitor`、`core/track` 的接口**使用监控埋点,禁止直接 import `@arms/rum-browser`。

## 2. arco 按需引入纪律

- `@arco-design/mobile-react` 一律经 `modern.config.ts` 的 `source.transformImport` 按需引入(样式随组件),**禁止全量 `import { X } from "@arco-design/mobile-react"`** 与全量 CSS 引入;
- 移动适配走 postcss px-to-vw(设计稿宽 375,配置在 `modern.config.ts`),业务样式以 px 书写即可,禁止手写 vw 换算。

## 3. SSR 安全

- 服务端/客户端判环境统一 `typeof window === "undefined"`,禁止其他写法;
- **模块顶层禁止触碰浏览器 API**(window/document/localStorage 等):监控/埋点/白屏检测全部动态初始化 + 环境守卫(SSR 下 no-op),新增 core 能力必须带 SSR 分支单测;
- 客户端可见 env 经 `modern.config.ts` 的 `source.define` 构建期内联(照抄 site 模式),**禁止在客户端分支裸读 `process.env`**(bundle 内无 process,实测会 ReferenceError)。

## 4. 监控/埋点/稳定性只走 core 抽象

- 错误上报经 `core/monitor` 的 `getReporter()`,埋点经 `core/track` 的 `getTracker()`;ARMS(`@arms/rum-browser`)是默认实现且仅客户端初始化,`RUM_ENDPOINT`/`RUM_PID` 任一缺失自动降级 no-op(dev 默认关闭,对齐根规则 21);
- 稳定性三件套(ErrorBoundary/全局错误捕获/白屏检测)在 `core/stability` 与 `core/monitor/capture`;装配点只在 `routes/layout.tsx`(ShellBootstrap),业务页面不得自行安装/拆卸全局捕获;
- 禁止绕过 facade 手写上报 HTTP 或直接 new 监控 SDK 实例。

## 5. 数据流约定

- 服务端数据一律走路由 loader(`src/routes/*.data.ts` 具名导出),组件 `useLoaderData` 读取;**loader 内禁止引用客户端状态,请求失败必须自捕获降级为 null**,页面端渲染降级文案(见 `routes/page.tsx`);
- 客户端全局状态用 zustand(`src/store/`),服务端数据不进 zustand,禁止 useEffect 手动拉接口(根规则 19 同款)。

## 6. 测试纪律

- 六类边界必查:空值、零值、越界、权限缺失(匿名受众聚焦越界与非法状态)、网络失败、非法状态迁移;用例与实现同批交付;
- 覆盖率门槛(vitest.config.ts,只许调高):`src/core/**` ≥ 80%,全局 ≥ 60%;
- e2e 为根 playwright 的 `h5`(移动视口 18082)与 `h5-fallback`(API 死端口 18083,降级文案)两个 project。

## 7. 文件纪律

- 生成物禁改:`src/api/generated/**`、`src/api/controllers.gen.ts`(契约变更:改 [openapi/h5/](../../openapi/h5/) → `pnpm gen:api` → 补实现);
- 产物体积预算:`size-budget.json` + `scripts/check-size.mjs`(挂进 build),超预算先改预算并说明理由,不在脚本里硬编码;
- 主题/分享文案只改 `src/config/`(feature/share/env),不在组件里散落常量。

## 8. JSBridge 调试页(docs/hybrid-capability-plan.md 阶段 3 落地)

- `/jsbridge-test` 是消费 `@repo/js-bridge`(workspace 包,packages/js-bridge)的联调调试页,生产保留;
- 页面必须保持 client-only(mounted 门控)与 SSR 安全:禁止模块顶层访问 `window`,`typeof window === "undefined"` 时只渲染初始化占位;build 通过即 SSR 安全证明;
- 非 webview 环境(纯浏览器)`callNative` reject `BRIDGE_NOT_AVAILABLE`,页面顶部常驻降级提示,不得隐藏或 try/catch 吞掉;
- 调用走 `handle.runtime.bridge.callNative`(setupJSB 实例),禁止使用包级 `callNative` 代理(未 setup 时同步抛错);协议与 native 侧(apps/mobile `core/hybrid/jsb_registry.dart`)契约互为镜像,改动必须两侧同批。
