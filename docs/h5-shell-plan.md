# H5 通用壳建设方案：apps/h5 能力基座

> 状态：**待评审**（方案记录，未开始执行）
> 日期：2026-09-19
> 范围：把 `apps/h5`（Modern.js SSR，活动 H5 受众）从 hello-world 占位打造成**通用壳**——无具体业务，提前建好性能优化、错误监控上报、埋点上报、稳定性建设、自动化测试；需要配置的地方留配置坑；附 `apps/h5/AGENTS.md` 约束规范保证后续修改不破坏架构。
> 前置说明：原始需求中"Arco Design Mobile + tree-shaking"的对象是 **h5**（@arco-design/mobile-react 是 React 库，天然契合移动 H5）；apps/mobile（Flutter）维持占坑现状，不在本方案内。

---

## 0. TL;DR

| 项             | 结论                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI 基座        | `@arco-design/mobile-react`，经 Modern.js（Rsbuild）`source.transformImport` 按需引入实现 tree-shaking；主题令牌集中一层，业务页优先用壳封装组件                             |
| 监控/埋点      | 抽象 `Reporter`/`Tracker` 接口 + **ARMS 默认实现**（`@arms/rum-browser`，复用 site 的 `RUM_ENDPOINT`/`RUM_PID` env 约定，构建期 define 注入，缺失不初始化）；Sentry 留实现位 |
| 状态/路由/网络 | 维持仓库既有约定：zustand、Modern.js 文件路由 + loader、axios + orval 生成物（本方案不动）                                                                                   |
| 稳定性         | ErrorBoundary + 全局错误/未捕获 Promise/资源错误捕获 + 白屏检测 + SSR 失败降级文案                                                                                           |
| 自动化测试     | vitest 单测/组件测试 + core 层 coverage 门槛 + playwright 新增 h5 project（移动视口）                                                                                        |
| 配置坑         | env 槽位集中类型化（API/RUM/分享/feature flag），`.env.example` 齐全                                                                                                         |
| 工作量         | 约 **4~5 人日**；planner 编排 + coding-agent 执行，**实测最大并行 6**，并行后约 **1.5~2 日历天**                                                                             |

---

## 1. 决策记录

1. **目标端是 h5 不是 mobile**。Arco Design Mobile（`@arco-design/mobile-react`）只支持 React，面向移动 H5/WebView，与 apps/h5 天然契合；tree-shaking 指 bundler 按需引入。Flutter 端不存在 Arco，本方案与 apps/mobile 无关。
2. **监控/埋点：抽象层 + ARMS 默认**。H5 是 Web 场景，`@arms/rum-browser` 已在 site 验证过（含"构建期 define 注入 env，避免浏览器进程 process 崩溃"的既有修复）；抽象层只依赖接口，Sentry 作为备选实现位（Flutter 场景曾选 Sentry，因 `aliyun_arms` Dart 插件 3 年未维护——该理由不适用于 Web）。
3. **状态/路由/网络不重新选型**：zustand、Modern.js 路由 + loader、axios + orval 是仓库既定约定（AGENTS.md 规则 8/19），壳建设不引入平行方案。
4. **按需引入走 `source.transformImport`**：对齐 admin 对 `@arco-design/web-react` 的处理方式；禁全量 `import { X } from "@arco-design/mobile-react"` 出现在业务页（由 AGENTS.md 约束）。
5. **配置坑集中类型化**：所有可调项收进 `src/config/`（env 读取 + 类型 + 默认值 + 注释），禁止散落 `process.env` 直读；客户端可见变量经 modern.config.ts `source.define` 构建期注入（沿用 site 的 RUM env 模式）。
6. **并发编排实测结论**（2026-09-19 探针实测）：`coding-agent-2` 已注册可用（`~/.zcode/agents/coding-agent-2.md`，deepseek-v4.1-flash，与 coding-agent 的 GLM-5.3-Flash 互为补充池）；实测同波 6 个并行 agent 全部成功（3 coding-agent + 2 coding-agent-2 + 1 general-purpose）。**并发上限为账户级、跨会话共享**——早前 4× coding-agent 被限流发生在多会话并行执行期间；其他会话空闲时上限 ≥6。编排按**最大并行 6** 设计，planner 须对限流拒绝做排队重试。

---

## 2. 差距盘点（"目前还差什么"清单）

| #   | 缺口               | 现状                                                                                |
| --- | ------------------ | ----------------------------------------------------------------------------------- |
| 1   | UI 组件库未接入    | h5 无任何组件库；无按需引入配置；无主题令牌层                                       |
| 2   | 移动适配未落地     | 无 viewport/root-font 策略；无 px-to-vw 转换（设计稿 375 约定缺位）                 |
| 3   | 监控/埋点无抽象层  | site 是直接用 `@arms/rum-browser`，无接口抽象；h5 完全没有                          |
| 4   | 稳定性三件套缺位   | 无 ErrorBoundary、无全局错误捕获、无白屏检测、SSR 失败无降级约定                    |
| 5   | 配置体系未成坑     | 仅 `.env.example` 一个 `H5_API_BASE`；无类型化 env 模块；分享/OG 配置坑缺位         |
| 6   | 性能基线未建       | 无产物体积预算与检查脚本；无路由懒加载/图片懒加载纪律                               |
| 7   | 自动化测试深度不足 | 仅 1 个 loader 冒烟单测；无组件测试规范、无 coverage 门槛、playwright 无 h5 project |
| 8   | 架构约束文件缺位   | 无 `apps/h5/AGENTS.md`，壳能力边界无法约束后续修改                                  |

---

## 3. 目标架构

```
apps/h5/src/
  api/          # 既有：orval 生成物 + client.ts + controllers.gen.ts
  component/    # 通用组件（壳封装，如 PageShell/ErrorView/ShareHeader）
  config/       # 配置坑集中：env.ts(类型化读取) + feature.ts + share.ts
  consts/
  hooks/
  store/        # zustand
  routes/       # 页面：只做数据编排（loader + useLoaderData）
  core/         # 壳能力层（新增分区，本方案核心）
    monitor/    # reporter.ts(接口) + arms.ts(默认实现) + noop.ts
    track/      # tracker.ts(接口:page/event) + arms.ts + console.ts(dev)
    stability/  # ErrorBoundary + global-error.ts + white-screen.ts
    perf/       # （占位）启动耗时标记、资源计时上报埋点
```

依赖方向（写进 AGENTS.md 的硬约束）：`routes → {component, hooks, store, api, core}`；`core → config`；**`core` 不依赖 `routes`/`store`**；业务代码（routes/component）**只允许经 `core/monitor`、`core/track` 的接口**使用监控埋点，禁止直接 import `@arms/rum-browser`。

关键设计：

- **监控/埋点初始化**：根布局 client-only 动态 `import("@arms/rum-browser")`（SSR 安全，`typeof window` 守卫）；`RUM_ENDPOINT`/`RUM_PID` 任一缺失不初始化（对齐 AGENTS.md 规则 21）；env 经 modern.config.ts `source.define` 构建期内联（沿用 site 既有修复模式）。
- **稳定性**：ErrorBoundary 包裹根布局（降级 UI + 上报）；`error`/`unhandledrejection`/资源错误全局捕获 → reporter；白屏检测（挂载超时根节点为空 → 上报事件 + 展示降级）；SSR loader 失败已有降级 null 约定，补"SSR 渲染失败回退 CSR 重试"的文档约定（不实现复杂降级框架）。
- **性能**：`source.transformImport` 按需引入 arco 组件与样式；产物体积预算脚本（`scripts/check-size.mjs` + `size-budget.json` 配置坑，挂进 build 后检查）；图片 `loading="lazy"` 与 CDN 直链约定写进 AGENTS.md。
- **移动适配**：viewport meta + `postcss-px-to-viewport`（设计稿宽 375，配置坑），arco 组件样式纳入转换范围。
- **分享/SEO 坑**：`src/config/share.ts` 集中 title/description/og:image/微信分享占位（JSSDK 不接入，只留配置位与 TODO 注释）。

## 4. 自动化测试体系

- **单测**（vitest）：`core/` 全部纯逻辑（reporter/tracker 降级、env 解析、白屏判定函数）——六类边界用例（空值/零值/越界/权限缺失/网络失败/非法状态迁移）按仓库测试纪律；
- **组件测试**（jsdom）：ErrorBoundary 三态、PageShell、壳封装组件；
- **coverage 门槛**：`src/core/**` ≥ 80%（lines/branches/functions/statements），全局 ≥ 60%（起步值，写在 vitest.config，后续只许调高）；
- **e2e**：`playwright.config.ts` 新增 `h5` project（移动视口设备描述符）+ webServer `18082`；首用例：首页 SSR 渲染出接口返回值、断网降级文案可见。

## 5. 分阶段计划与并行编排

编排模型同前方案：planner 出任务卡（文件所有权 + 验收命令 + 禁止事项）→ coding-agent / coding-agent-2 执行 → 阶段门禁（`pnpm verify`）。**全局最大并行 6**（探针实测，账户级跨会话共享，遇限流排队重试），lockfile 仍由收口独占；本方案全部工作在 `apps/h5/` + `playwright.config.ts`（单点）+ 文档，爆炸半径小。

### 阶段 1：基座（并行度 2，两个任务卡文件不相交）

| 任务卡           | 内容                                                                                                                                                                                                                                                                                                             | 验收                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1.A UI 基座      | package.json 加 `@arco-design/mobile-react`（`npm view` 钉版，注意 React 19 peer 兼容，不兼容则钉兼容的最新版并在报告中说明）；modern.config.ts 加 `source.transformImport` 按需引入 + postcss px-to-vw（375）+ viewport meta；`src/component/` 建 PageShell 等 2~3 个壳封装组件；首页改用壳组件重排（功能不变） | 无法 install，静态审查 + prettier；build 验证留收口 |
| 1.B 配置与抽象层 | `src/config/env.ts`（类型化读取 H5*API_BASE/RUM*\* 等，define 注入对齐 site 模式）+ `feature.ts` + `share.ts`；`core/monitor                                                                                                                                                                                     | track                                               | stability | perf` 骨架：**接口 + noop/console 默认实现 + 目录约定**（ARMS 实现留阶段 2）；`.env.example` 补全槽位 | 同上 |

### 阶段 2：能力实现（并行度 3，依赖阶段 1 的接口）

| 任务卡              | 内容                                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.A 监控            | `core/monitor/arms.ts`：`@arms/rum-browser` 默认实现（动态 import、env 缺失不初始化、client-only）；全局错误/unhandledrejection/资源错误捕获接线；单测（env 缺失降级、捕获转发） |
| 2.B 埋点            | `core/track/arms.ts` + console(dev) 实现；页面 PV 自动化的坑（routes 层埋点 hook 约定）；单测                                                                                    |
| 2.C 稳定性 + 分享坑 | `core/stability/`：ErrorBoundary 组件（降级 UI + 上报走 monitor 接口）+ 白屏检测；`config/share.ts` 消费进根布局 meta/OG 槽位（微信 JSSDK 只留 TODO）；组件测试                  |

### 阶段 3：收口与装配（并行度 1，依赖阶段 1+2）

| 任务卡 | 内容                                                                                                                                                                            | 验收                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 3.1    | 独占 `pnpm install`（lockfile）；根布局装配（ErrorBoundary 包裹 + monitor/track 初始化接线）；`pnpm verify` 全绿；h5 dev 起 18082 实测 SSR 页面；产物体积检查脚本就位并跑通一次 | verify exit 0 + curl 18082 页面正常 |

### 阶段 4：测试体系（并行度 1，依赖阶段 3；与阶段 5 并行）

| 任务卡 | 内容                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1    | vitest coverage 门槛接入（core ≥80/全局 ≥60）；`playwright.config.ts` 加 h5 project + webServer 18082 + 首组 e2e 用例；确认 CI `test:e2e` 自动覆盖（root test 已含 playwright） |

### 阶段 5：文档收口（并行度 1，依赖阶段 3；与阶段 4 并行，文件不相交）

| 任务卡 | 内容                                                                                                                                                                                                                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1    | **`apps/h5/AGENTS.md`**（本方案核心交付物）：分层依赖方向、arco 按需引入纪律、SSR 安全（`typeof window`/禁模块顶层浏览器 API）、监控埋点只能走 core 抽象、loader 数据流约定、六类边界测试纪律、生成物禁改；更新 `apps/h5/README.md`（壳能力清单 + 配置坑表）；根 AGENTS.md 规则 22 节补一句指向 apps/h5/AGENTS.md |

### 排期

```
阶段1 (1.A ∥ 1.B, 2人)
  └─► 阶段2 (2.A ∥ 2.B ∥ 2.C, 3人；上限 6 内不满载)
        └─► 阶段3 (收口, 1人, lockfile 独占)
              ├─► 阶段4 (测试, 1人)
              └─► 阶段5 (文档, 1人)
```

估算：阶段 1 各 0.5~~1 人日；阶段 2 各 0.5~~1 人日；阶段 3 ≈ 0.5；阶段 4 ≈ 0.5~~1；阶段 5 ≈ 0.5。合计 **4~~5 人日，并行后约 1.5~2 日历天**。

## 6. 风险清单

| 风险                                                  | 等级 | 缓解                                                                                                |
| ----------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- |
| `@arco-design/mobile-react` 与 React 19 peer 不兼容   | 中   | 任务卡 1.A 钉版时 `npm view peerDependencies` 核对；不兼容则钉最新兼容版并在收口 install 验证       |
| arco-mobile 样式（Less）与 Modern.js/Rsbuild 集成差异 | 中   | 对齐 admin 的 web-react 处理先例；transformImport 样式映射在收口以 build 产物体积与页面渲染双重验证 |
| RUM env 浏览器端注入（site 曾踩 process 崩溃）        | 低   | 沿用 site 已修复的 define 构建期注入模式，禁运行时 process.env                                      |
| 移动适配 px-to-vw 影响 arco 组件样式                  | 低   | 转换范围含 arco 样式；收口以真机视口截图人工核对                                                    |
| 白屏检测误报                                          | 低   | 超时阈值 + 仅上报不阻断；阈值留配置坑                                                               |
| SSR 下监控 SDK 初始化泄漏到服务端                     | 低   | 动态 import + `typeof window` 守卫；单测覆盖 SSR 分支                                               |

## 7. 后续阶段（明确不在本次）

1. 微信 JSSDK 接入（分享坑已留）；
2. Sentry 备选实现落地（接口位已留）；
3. site 监控接入重构到同款抽象层（site 维持现状不动）；
4. e2e 扩充（活动页模板用例、性能断言）；
5. apps/mobile（Flutter）壳建设：另立方案（Sentry 默认 + Riverpod + go_router + dio 的选型已在评审中记录）。

## 8. 执行记录

| 阶段         | 状态      | 提交              | 备注                                                                                             |
| ------------ | --------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| 0 方案评审   | ✅ 本文档 | —                 | 2026-09-19，决策记录见 §1                                                                        |
| 1 基座       | ✅ 完成   | 349615b / 0b3cd13 | 1.A arco-mobile 按需 + px-to-vw + 壳组件；1.B env/feature/share + core 四模块骨架（40 用例全绿） |
| 2 能力实现   | ✅ 完成 | 7ff58f6 / 07329b1 / b8d1061 | ARMS monitor+tracker+stability;132 用例 |
| 3 收口与装配 | ✅ 完成   | d6e5a90           | install+装配+check-size;根 verify 全绿;18082 SSR 实测;admin tsconfig 存量修复随卡                |     |
| 4 测试体系   | ✅ 完成 | 0e6a175 | 覆盖率门禁+playwright h5/h5-fallback 两 project |
| 5 文档收口   | ✅ 完成   | 9bcfd3f           | AGENTS.md+README 壳能力/配置坑+根 22a 指向行                                                     |
