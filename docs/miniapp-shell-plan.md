# 小程序通用壳建设方案（apps/miniapp）

> 状态：**待评审**（方案记录，未开始执行）
> 日期：2026-09-19
> 范围：把 `apps/miniapp` 从占坑工程升级为**通用壳**——不含具体业务，性能优化、错误监控、埋点上报、稳定性、自动化测试全部预置；一切环境差异走配置坑；附 `apps/miniapp/AGENTS.md` 作为架构护栏，保证后续写业务不破坏壳。
> 编排约定：planner 出任务卡 + coding-agent 执行 + 阶段门禁，与 docs/monorepo-expansion-plan.md 相同。

---

## 0. TL;DR

| 项        | 结论                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目标      | 零业务通用壳：监控/埋点/性能/稳定性/测试基础设施全就位，业务页面进来只管写业务                                                                    |
| 核心差距  | 基础设施七域全缺：配置体系、错误监控、埋点、性能、稳定性、E2E、架构护栏（详见 §2）                                                                |
| 上报通道  | 端侧统一 facade + 可配置多 sink：console（dev 默认）/ 微信实时日志（prod 默认）/ HTTP sink（endpoint 留坑，空则禁用）；**不动 server、不接 SaaS** |
| E2E       | miniprogram-automator 冒烟脚本仅本地；CI 门禁 = 单测 + 覆盖率 + 包体积                                                                            |
| core 纪律 | `src/core/` **零第三方运行时依赖**（监控/埋点全自研，KB 级），保护主包体积                                                                        |
| 工作量    | 约 **4~5 人日**；最大并行 **3**，并行后约 **1.5~2 日历天**                                                                                        |

---

## 1. 现状盘点（上一阶段已交付）

| 已有     | 说明                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| 网络层   | `src/api/client.ts` mutator 直桥 `Taro.request`，信封 `{code,message,data}` 解包；orval 生成物 + `controllers.gen.ts` |
| 目录骨架 | `api/ component/ config/ consts/ hooks/ store/`（后四个为空壳 .gitkeep）                                              |
| 配置     | `src/config/index.ts` 仅一个 `API_BASE_URL` 常量                                                                      |
| 测试     | vitest 11 例（信封解包纯逻辑），无覆盖率配置                                                                          |
| 工程门禁 | lint / typecheck / test / build（taro build weapp）已进 turbo 与 CI                                                   |
| 文档     | `apps/miniapp/README.md`（开发者工具导入、域名校验说明）                                                              |

## 2. 差距清单（目前还差什么）

| 域         | 缺什么                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 配置体系   | 多环境表（dev/test/prod）；构建时注入（版本号/构建时间 defineConstants）；appid 坑（`project.config.json` 还是 touristappid）；上报 endpoint / 采样率 / 功能开关坑 |
| 错误监控   | App 级全局捕获（onError / onUnhandledRejection / onPageNotFound 未接）；错误规范化、去重、采样；批量队列与上报通道                                                 |
| 埋点       | 事件模型（page_view / click / custom）；公共参数（设备/网络/版本/uid 坑）；自动 page_view 挂钩；批量 flush 与总开关                                                |
| 性能       | 采集：启动/首屏耗时、`wx.getPerformance` 未接；优化：`lazyCodeLoading: requiredComponents` 未开、分包结构未约定、骨架屏/图片懒加载组件缺失、setData 与长列表规范无 |
| 稳定性     | api 层无超时/重试/错误分类上报；endpoint 为空时的降级行为未定义；**包体积无门禁（微信主包 2MB 硬限制）**                                                           |
| 自动化测试 | 无覆盖率门槛；无 E2E（automator）；core 模块测试规范缺失                                                                                                           |
| 架构护栏   | 无 `apps/miniapp/AGENTS.md`——业务上来后"绕过 mutator 裸写 Taro.request、页面散落 wx.* 调用、配置散落各处"等劣化无人拦截                                            |

## 3. 决策记录

1. **上报通道：facade + 多 sink**。端侧只面向 `core/monitor`、`core/track` 的统一 API；sink 三实现可配置组合：console（dev 默认）、微信实时日志 `wx.getRealtimeLogManager`（prod 默认、零成本零依赖）、HTTP sink（`MONITOR_ENDPOINT` / `TRACK_ENDPOINT` 留坑，空则该 sink 禁用）。**server 侧 /track、/error 端点本次不做**（列入后续阶段，契约先行）；不接 ARMS/SaaS SDK。后续无论接自研端点还是 SaaS，都只是新增一个 sink，业务与壳代码零改动。
2. **E2E：automator 本地冒烟脚本，不进 CI**。微信开发者工具是 GUI + 登录态依赖，GitHub runner 不现实；CI 三道门禁 = 单测 + 覆盖率门槛 + 包体积检查。
3. **core 零依赖**：`src/core/` 禁止 import 任何第三方运行时包（eslint `no-restricted-imports` 固化），监控/埋点/性能全部自研（合计 KB 级），保护主包 2MB 预算。
4. **配置集中**：一切环境差异只允许出现在 `src/config/`（多环境表），业务代码禁止散落 `process.env` 判断；Taro `defineConstants` 注入 `__APP_VERSION__`、`__BUILD_TIME__`。
5. **架构护栏成文**：新建 `apps/miniapp/AGENTS.md`（该端最高约束，是根 AGENTS.md 规则 22-25 的展开），含目录职责、硬性禁止事项、新增页面/埋点 checklist。
6. **覆盖率门槛**：`src/core/` ≥ 90% lines，整体 ≥ 70%（占坑期基线，业务进来后可调）。

## 4. 目标架构

```
apps/miniapp/src/
  api/            # 已有（orval 生成物 + mutator）；本次增强：超时/重试/错误挂钩
  component/      # + Skeleton.tsx（骨架屏）、SafeImage.tsx（lazy-load 图片封装）
  config/         # index.ts 扩为多环境表（dev/test/prod）+ types.ts
  consts/
  hooks/          # + usePageTrack.ts（页面级 page_view 埋点挂钩）
  store/
  core/           # 壳基础设施，零依赖，业务代码禁止修改
    transport/    # queue.ts（批量队列+定时 flush+app hide flush+上限丢弃）/ sink.ts（console|wechat|http）
    monitor/      # 错误规范化 + 采样 + capture API + 全局挂钩注册函数
    track/        # 事件模型 + 公共参数组装 + track/pageView API
    perf/         # wx.getPerformance 采集 + 启动/首屏耗时 + 自定义 mark
  pages/
app.tsx           # 接线：useError / useUnhandledRejection / usePageNotFound → monitor
app.config.ts     # lazyCodeLoading: requiredComponents + subpackages 骨架坑
```

数据流：`事件 → monitor/track facade → 采样 → transport.queue → sink（console / wechat-log / http）`

**配置的坑清单**（全部集中在 `src/config/index.ts` 环境表 + `project.config.json`）：

| 配置项                                      | 默认                             | 说明                                     |
| ------------------------------------------- | -------------------------------- | ---------------------------------------- |
| `API_BASE_URL`                              | `http://localhost:18085`（已有） | 生产改正式域名                           |
| `MONITOR_ENDPOINT` / `TRACK_ENDPOINT`       | `""`（空 = HTTP sink 禁用）      | server 端点落地后填入即启用              |
| `MONITOR_SAMPLE_RATE` / `TRACK_SAMPLE_RATE` | `1`                              | 0~1 采样率                               |
| `TRACK_ENABLED` / `MONITOR_ENABLED`         | `true`                           | 总开关                                   |
| `__APP_VERSION__` / `__BUILD_TIME__`        | defineConstants 注入             | 公共参数与问题定位用                     |
| appid                                       | `touristappid`                   | `project.config.json`，申请后替换        |
| subpackages                                 | 空数组骨架                       | `app.config.ts` 留坑，业务页面默认进分包 |

## 5. 分阶段计划与并行编排

编排模型：planner → 任务卡（文件所有权 + 验收命令 + 禁止事项）→ coding-agent → 门禁。单点约束：`pnpm-lock.yaml`（全程禁 install，收口独占）、`src/app.tsx` 与 `src/api/client.ts`（接线单点，阶段 3 独占）、`turbo.json` 与根脚本（收口独占）。**全局最大并行 3**（阶段 3 与 4a/4b 同波）。

- 新增 devDependencies（`@vitest/coverage-v8`、`miniprogram-automator`）由任务卡写入 package.json，install 统一在阶段 7 收口。

### 阶段 1：配置体系 + core/transport 公共件（并行度 1）

| 任务卡 | 内容                                                                                                                                                                                                                                                                               | 验收                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1.1    | `src/config/` 多环境表（dev/test/prod 三份，含上表全部配置项）+ types.ts；`config/index.ts`（Taro 配置）加 defineConstants 注入 `__APP_VERSION__`/`__BUILD_TIME__`；`project.config.json` appid 保持 touristappid 并注释留坑                                                       | `tsc --noEmit` 过（复用已有 node_modules） |
| 1.2    | `src/core/transport/`：queue.ts（批量 ≥10 或 5s flush、app hide 时 flush、队列上限 100 溢出丢最旧、HTTP 失败重试 1 次后丢弃）+ sink.ts（console / wechat `wx.getRealtimeLogManager`（`wx.canIUse` 判空降级）/ http（复用 api 信封约定，endpoint 空则禁用））；单测覆盖队列全部分支 | `vitest run` 过                            |

### 阶段 2：core 三模块（并行度 3，依赖阶段 1）

| 任务卡      | 内容                                                                                                                                                                                                 | 验收                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 2.1 monitor | 错误规范化（js / api / unhandled_rejection / page_not_found 四类，message+stack+extra）、采样、`captureError/captureMessage` API、`registerGlobalHooks()`（供 app.tsx 一行接线）                     | 单测全绿                     |
| 2.2 track   | 事件模型（`page_view`/`click`/`custom`）、公共参数组装（设备/系统/网络/`__APP_VERSION__`/uid 坑=null）、`track()/pageView()` API、`hooks/usePageTrack.ts`（基于 `useDidShow`，输出归 core/track 管） | 单测全绿                     |
| 2.3 perf    | `wx.getPerformance` 采集（canIUse 降级）、启动耗时（App onLaunch 计时）、`mark(name)/report()` 自定义指标 API                                                                                        | 单测全绿（wx API 全部 mock） |

### 阶段 3 + 4：接线与加固（并行度 3，依赖阶段 2；三者文件所有权互不相交）

| 任务卡      | 独占文件                                                                  | 内容                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3 接线      | `app.tsx`、`api/client.ts`、`pages/index/`                                | app.tsx 用 `useError/useUnhandledRejection/usePageNotFound` 一行接线 monitor，useLaunch 启动 perf 计时；client.ts 加超时（10s）、GET 幂等重试 1 次、错误分类上报挂钩 monitor；index 页接 `usePageTrack` 做示例 |
| 4a 构建加固 | `app.config.ts`、`config/index.ts`（Taro 配置）、`scripts/check-size.mjs` | 开 `lazyCodeLoading: "requiredComponents"`；subpackages 空骨架 + 注释坑；check-size.mjs 检查 `dist/` 主包体积（>2MB 硬失败、>1.5MB 警告），package.json 加 `check:size` script                                 |
| 4b 组件     | `component/Skeleton.tsx`、`component/SafeImage.tsx`                       | Skeleton（骨架屏占位，props 控制行数/圆角）；SafeImage（lazy-load + mode + 加载失败兜底）；各带 vitest 纯逻辑/快照可行的测试                                                                                   |

### 阶段 5：测试与门禁（并行度 2，依赖阶段 3+4）

| 任务卡    | 内容                                                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5a 覆盖率 | devDeps 加 `@vitest/coverage-v8`；vitest.config.ts 加 coverage 配置与门槛（core ≥90%、整体 ≥70%）；补齐 core 模块单测至达标                                                                             |
| 5b E2E    | devDeps 加 `miniprogram-automator`；`e2e/smoke.test.mjs`：启动开发者工具 → 打开首页 → 断言 ping 文案渲染；package.json 加 `test:e2e`（注释标明本地专用、需开发者工具开启自动化端口）；README 补前置条件 |

### 阶段 6：架构护栏文档（并行度 1，与阶段 5 并行，文件不相交）

| 任务卡 | 内容                                                                                                                                                                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 6.1    | 新建 `apps/miniapp/AGENTS.md`：架构图（壳 vs 业务边界）、硬性规则（网络唯一入口 api/、禁裸 `Taro.request`、监控/埋点只经 core API、配置只经 config/、生成物禁手改、core 零依赖、业务页面默认进分包）、新增页面/埋点 checklist；更新 `apps/miniapp/README.md`（配置坑清单、e2e 前置）；根 AGENTS.md 规则 22-25 加交叉引用 |
| 6.2    | `apps/miniapp/eslint.config.js` 加 `no-restricted-imports`：`src/core/**` 禁第三方运行时 import（纪律工具化）                                                                                                                                                                                                            |

### 阶段 7：收口（并行度 1，依赖阶段 5+6）

| 任务卡 | 内容                                                                                                                                                          | 验收               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 7.1    | 独占 `pnpm install`（两个新 devDeps）→ 全量 lint/typecheck/test/build 修绿；`turbo.json` 与 `scripts/verify.sh` 挂 `check:size`（turbo 单点文件，仅收口可动） | `pnpm verify` 全绿 |
| 7.2    | 门禁实跑：`taro build --type weapp` 产物跑 check-size；automator 脚本仅语法验证（本机无开发者工具则如实记录，不视为失败）                                     | check:size 通过    |

### 排期与并行图

```
阶段1 (配置+transport, 1人)
  └─► 阶段2 (monitor/track/perf, 3人并行)
        └─► 阶段3+4 (接线 / 构建加固 / 组件, 3人并行)
              └─► 阶段5 (覆盖率 / e2e, 2人并行) + 阶段6 (护栏文档, 1人) —— 同波 3 并行
                    └─► 阶段7 (收口, 1人, lockfile 独占)
```

估算：阶段 1 ≈ 0.5 人日；阶段 2 每模块 0.5；阶段 3 ≈ 0.5；阶段 4a/4b 各 0.5；阶段 5 各 0.5；阶段 6 ≈ 0.5；阶段 7 ≈ 0.5。合计 **4~~5 人日，并行后约 1.5~~2 日历天**。

## 6. 风险清单

| 风险                                                                            | 等级 | 缓解                                                                      |
| ------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------- |
| 微信 API 基础库兼容（`getRealtimeLogManager` 2.7.1+、`getPerformance` 2.11.0+） | 中   | 一律 `wx.canIUse` 判空降级；project.config.json `libVersion` 钉项目最低库 |
| automator 依赖开发者工具 GUI/自动化端口，本机与 CI 都跑不了                     | 中   | 定位本地脚本；README 写明前置；脚本检测失败给清晰报错而非挂死             |
| 新增 devDeps（coverage-v8、automator）与既有树冲突                              | 低   | 收口独占 install，冲突只动版本号                                          |
| core 零依赖纪律被后续业务破坏                                                   | 中   | eslint `no-restricted-imports` 工具化 + AGENTS.md 成文双保险              |
| 覆盖率门槛误伤早期业务                                                          | 低   | 门槛只收 core 90%/整体 70%，业务上来后评审调整                            |
| app.tsx/client.ts 接线冲突                                                      | 低   | 阶段 3 独占这两个文件，其他任务卡禁止触碰                                 |

## 7. 后续阶段（明确不在本次）

1. server 侧 `/api/app/track`、`/api/app/error` 端点（契约先行：openapi/app 加 paths，落库/落日志 + 查询入口），落地后仅需在 miniapp 配置坑填 endpoint；
2. 采样率/开关的远程下发（配置中心），uid 公共参数接 C 端用户体系；
3. 真机性能面板与告警、灰度发布流程；
4. automator 进自托管 runner CI；
5. h5/desktop 复用同款 core 模式（本方案 core 设计保持平台无关部分可移植）。

## 8. 执行记录

| 阶段                   | 状态      | 提交 | 备注                                                                   |
| ---------------------- | --------- | ---- | ---------------------------------------------------------------------- |
| 0 方案评审             | ✅ 本文档 | —    | 2026-09-19；两个决策点（上报通道、E2E 范围）按推荐项默认，评审时可否决 |
| 1 配置体系 + transport | ✅ 完成 | d1dc2d3 / c4eda14 | 多环境表+defineConstants;transport 队列 47 用例 |
| 2 core 三模块          | ✅ 完成 | 2902fc4 / ee173e4 / eea4758 | track/monitor/perf 三模块;93 用例 |
| 3+4 接线与加固         | ✅ 完成 | b9b22f7 / 6eaa3e7 / fc1998f | app 接线+client 韧性;lazyCodeLoading+check-size;组件 |
| 5 测试与门禁           | ✅ 完成 | f0ac00f / 0f995fb | coverage 门槛(core 90/全局 70)+automator 脚本 |
| 6 架构护栏文档         | ✅ 完成 | f107dba / 988b461 | AGENTS.md 七节+README+根 25a;eslint 纪律 |
| 7 收口                 | ✅ 完成 | 9a34a90 | L1#3 install;turbo/verify 挂 check:size;覆盖率达标;根 verify 绿 |
