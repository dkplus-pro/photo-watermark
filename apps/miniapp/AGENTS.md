# apps/miniapp/AGENTS.md

本文件面向 AI 编码助手,是 `apps/miniapp`(Taro 4 + React 微信小程序,匿名公开受众)的架构约束规范。
根 [AGENTS.md](../../AGENTS.md) 规则 22-25 在此细化;壳建设方案与现状依据见 [docs/miniapp-shell-plan.md](../../docs/miniapp-shell-plan.md)。
本文件与根规则冲突时以本文件为准。

## 1. 架构边界:壳 vs 业务

```
src/
  api/          # 网络唯一入口(orval 生成物 + client.ts mutator 直桥 Taro.request + envelope 信封)
  core/         # 壳基础设施,零第三方运行时依赖,业务代码禁止修改
    transport/  #   上报管道:批量队列(queue.ts)+ 多 sink(console|微信实时日志|http)
    monitor/    #   错误规范化/采样/全局挂钩(接线在 app.tsx)
    track/      #   事件模型/公共参数/track-pageView API
    perf/       #   启动/首屏耗时与自定义指标(wx.getPerformance 采集)
  config/       # 配置唯一入口:多环境表 + defineConstants 常量类型
  component/    # 壳封装组件(Skeleton/SafeImage 等无业务语义)
  consts/ hooks/ store/   # 常量 / 组合式逻辑 / zustand 客户端状态
  pages/        # 业务页面(默认应进分包,见 app.config.ts subpackages 坑)
```

数据流:`事件 → monitor/track facade → 采样 → transport 队列 → sink`。业务只面向 facade,不感知 sink 与管道细节。

## 2. 硬性规则

1. **网络唯一入口**:所有请求经 `src/api/client.ts` mutator(orval 生成的 controllers 调用);禁止在页面/组件/core 里裸写 `Taro.request`/`wx.request`(小程序无 XMLHttpRequest,传输桥接与信封解包、超时、重试都收口在 client.ts,散写必翻车);
2. **监控/埋点只经 core API**:错误上报走 `core/monitor`,埋点走 `core/track`,禁止直接调 `wx.getRealtimeLogManager`、`wx.reportEvent` 或自行发上报请求;
3. **配置只经 `src/config/`**:环境差异(dev/test/prod 环境表)、采样率、endpoint、总开关全部收敛在环境表;业务与 core 禁止散落 `process.env` 判断(构建期常量 `__APP_VERSION__`/`__BUILD_TIME__` 经 `config/index.ts` 的兜底读取口取用,单测环境无注入);
4. **core 零第三方运行时依赖**:`src/core/**` 禁止 import 任何第三方包(eslint `no-restricted-imports` 固化,见 `eslint.config.js`);主包 2MB 预算红线,壳能力必须自研且 KB 级;
5. **生成物禁手改**:`src/api/generated/**`、`src/api/controllers.gen.ts` 由 `pnpm --filter @monorepo-template/miniapp gen:api` 从 [openapi/app/](../../openapi/app/) 生成;契约变更流程:改契约 → gen:api → 补实现;
6. **业务页面默认进分包**:`app.config.ts` 的 `subpackages` 留坑,新业务页面一律注册进分包,主包只保留首屏与壳(`lazyCodeLoading: "requiredComponents"` 已开启,勿删);
7. **匿名公开受众**:无鉴权、无 token 注入、无 401 跳转;契约预留 `bearerAuth`,C 端用户体系落地前 client.ts 不实现鉴权逻辑(根规则 23;token 注入挂点已在 client.ts 注释预留)。

## 2a. 公共能力使用约定(方案 docs/hybrid-capability-plan.md 阶段 5 落地)

1. **错误兜底**:页面级异步错误自行降级渲染;渲染期错误由 `component/ErrorBoundary`(app.tsx 根部已挂,componentDidCatch → core/monitor js_error)兜底,业务不得自行再包一层吞掉上报;
2. **页面状态**:统一用 `component/PageState`(loading/empty/error/success 四态),禁止各页面自拼 loading/error JSX;文案取组件默认(中文),自定义走 props;
3. **曝光埋点**:元素曝光用 `component/ExposeView` 或 `hooks/useExpose`(语义:≥50% 可见持续 300ms,页面实例级去重,同 trackId 只报一次);决策逻辑在 `core/track/expose-logic.ts` 纯函数,业务不得自行实现 IntersectionObserver 去重;事件经 `core/track` 的 `expose()` 上报;
4. **更新检查**:只经 `core/update`(wx.getUpdateManager 封装,app.tsx 已接线),业务不得重复注册 UpdateManager;失败回调走 core/monitor 上报。

## 3. 新增页面 checklist

1. 页面文件放分包目录并在 `app.config.ts` 的 `subpackages` 注册(占坑期主包页面仅 index);
2. 数据请求只用 `src/api/controllers.gen.ts` 生成函数,失败态按信封错误渲染降级 UI(参考 pages/index);
3. 页面根组件挂 `usePageTrack`(hooks,自动上报 page_view;公共参数由 core/track 组装,勿手动拼);
4. 骨架屏用 `component/Skeleton`、图片一律 `component/SafeImage`(懒加载 + 失败兜底);
5. 新增接口先改 [openapi/app/](../../openapi/app/) 契约再 gen:api,不手写请求函数与重复类型。

## 4. 新增埋点 checklist

1. 事件名走 `资源.动作` 蛇形命名(如 `order.submit`),与 server oplog 命名对齐;
2. 只调 `core/track` 的 `track()/pageView()`,payload 值必须可序列化(经 JSON 串化进队列);
3. 采样率与总开关由环境表控制,代码里不得自建开关;
4. 失败/异常场景走 `core/monitor.captureError`,不带业务语义埋点。

## 5. 测试纪律

- 六类边界必查:空值、零值、越界、权限缺失(匿名受众主要覆盖越界与非法状态)、网络失败、非法状态迁移;用例与实现同批交付;
- core 模块(wx API 全 mock)覆盖率门槛:`src/core/**` ≥ 90% lines,整体 ≥ 70%(占坑期基线,只许调高,见 vitest.config.ts);
- 单测跑 vitest(`pnpm --filter @monorepo-template/miniapp test`);e2e 为本地 automator 冒烟(见 README 前置条件),不进 CI。
