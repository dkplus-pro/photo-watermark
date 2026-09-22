# site 通用壳建设方案：性能 / 监控 / 埋点 / 稳定性 / 测试

> 状态：**待评审**（方案记录，未开始执行）
> 日期：2026-09-19
> 范围：把 `apps/site`（Modern.js SSR 对外站）打造成无业务的通用壳——Arco 基础组件库 + tree-shaking、性能优化、错误监控上报、埋点上报、稳定性建设、自动化测试强化、配置占位、site 本地 AGENTS.md 约束。不动任何其他应用。

---

## 0. TL;DR

| 项                     | 结论                                                                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 核心差距               | Arco **CSS 全量引入**（562 kB CSS chunk）、无埋点、无 ErrorBoundary、无性能预算、无视觉回归、无 env 校验、无 site 本地 AGENTS.md                         |
| 已有底子（不重复建设） | Arco 已接线（react-19 adapter + ConfigProvider）、ARMS RUM 已封装且 env 门控、26 条单测/组件测试、playwright site e2e、loader/降级范式、CSP meta（生产） |
| 执行量                 | 约 **5~5.5 人日**；峰值并行 **2**（单应用内 modern.config.ts 与 layout.tsx 是单点），并行后约 **2.5 日历天**                                             |
| 执行编排               | planner 出任务卡 + coding-agent 执行 + 每阶段 `pnpm verify` 门禁；依赖全部集中在阶段 1 一次 install，后续阶段零 lockfile 冲突                            |
| 并发上限说明           | **本环境无 coding-agent-2**（已实测，agent type 不存在）；实测可用峰值 = coding-agent ×2 + general-purpose ×1（扩展阶段已验证）。本方案峰值只需 2        |

---

## 1. 现状盘点：目前还差什么（差距表）

实测数据来自 `apps/site` 全量盘点（2026-09-19）：

| #   | 目标能力            | 现状              | 差距                                                                   | 证据                                                                                |
| --- | ------------------- | ----------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Arco 接线           | ✅ 已有           | —                                                                      | `layout.tsx` react-19 adapter + `ConfigProvider locale={zhCN}`；header/404 已用组件 |
| 2   | Arco tree-shaking   | ⚠️ JS 有 / CSS 无 | **全量 `arco.css` 562 kB（gzip 63 kB）**，未配 `transformImport`       | `layout.tsx` import `dist/css/arco.css`；构建日志 css chunk 562.1 kB                |
| 3   | 主题/token 配置坑   | ❌ 无             | ConfigProvider 无 theme；CSS 变量硬编码兜底值                          | `site-header.css` `var(--color-neutral-3, #e5e6eb)`                                 |
| 4   | 错误监控上报        | ✅ 已有           | RUM endpoint 未加进 CSP connect-src，开启即被拦                        | `src/config/rum.ts`（env 门控 + 动态 import）；`modern.config.ts` 注释已自标 TODO   |
| 5   | 埋点上报            | ❌ 无             | 全仓零 tracking 代码（历史决策"不做自定义埋点"，本次推翻）             | grep 无 track/sendBeacon                                                            |
| 6   | ErrorBoundary       | ❌ 无             | 渲染崩溃整树白屏；admin 有可抄实现                                     | `apps/admin/src/components/error-boundary.tsx`                                      |
| 7   | 接口韧性            | ⚠️ 部分           | axios 无超时/无重试；loader 有降级（好）                               | `src/api/client.ts` 仅 console.error                                                |
| 8   | 性能优化            | ❌ 无             | 无构建分析、无预算门禁、图片裸 `<img>`（无尺寸/懒加载）、无 web-vitals | dist 无 analyzer；`page.tsx` `<img src>`                                            |
| 9   | 单测/组件测试       | ✅ 已有           | 无覆盖率门禁；layout/page/404 未测                                     | 8 个测试文件 26 用例                                                                |
| 10  | e2e                 | ✅ 已有           | —                                                                      | `site-app.spec.ts`（禁 JS SSR、双端视口、RUM 关闭断言）                             |
| 11  | 视觉回归            | ❌ 无             | 零快照                                                                 | tests/playwright 无 screenshot                                                      |
| 12  | 配置占位            | ⚠️ 部分           | 有 `.env.example`，无 env 校验/类型化/特性开关模块                     | env 散落三处消费（client.ts / modern.config.ts / rum.ts）                           |
| 13  | site 本地 AGENTS.md | ❌ 无             | 约束散在根 AGENTS.md 18-21 + docs/site.md                              | apps/site 无 AGENTS.md/README                                                       |
| 14  | CSP 实证            | ⚠️ 待复验         | 现有 dist 产物疑似 dev 覆盖，需 clean build 复验 CSP meta              | dist html 无 CSP 匹配（mtime 晚于 build 日志）                                      |

**结论：壳的"地基"（SSR 数据流、RUM、响应式、测试栈、e2e）已经打好了，差的是"上层建筑"——体积收口、埋点、容错、预算门禁、配置收口、本地约束文档。**

---

## 2. 决策记录（执行前确认，附建议）

1. **Arco CSS 按需加载**：用 Rsbuild 原生 `source.transformImport`（arco 官方 recipe：`libraryDirectory: "es"` + `style: true`，icons 单独一条 `react-icon` 规则），删除全量 `arco.css` 引入。验收硬指标：CSS 产物从 562 kB 降到 **< 60 kB raw**。风险：按需样式可能漏 token 根变量——任务卡内建"构建 + 双端视口 e2e 回归"验证。
2. **埋点：自研 facade + 可插拔 sink**。`src/tracking/` 暴露 `track(event, payload)`/`trackPageView`，事件注册表集中在 `src/config/tracking-events.ts`；sink 三个：console（dev 默认）、ARMS RUM 自定义事件、自定义 HTTP endpoint（sendBeacon，留 `TRACK_ENDPOINT` 配置坑）。未配置时整体 no-op，dev 默认关。**不引入第三方分析 SDK**。
3. **性能门禁走"构建体积预算"，Lighthouse CI 缓做**。新增 `scripts/check-budgets.mjs`（gzip 体积断言，预算写在 `config/budgets.json` 配置坑里）挂进 CI；构建分析用 Rsbuild 内置 `performance.bundleAnalyze`（`ANALYZE=true pnpm build`），不引入新分析器依赖。Lighthouse CI 列入后续阶段（收益/维护成本比一般）。
4. **env 校验用 zod**（新依赖，~8 kB）：`src/config/env.ts` 启动时校验 + 类型化导出；特性开关集中 `src/config/features.ts`（rum/tracking/retry 开关）。不手写校验逻辑。
5. **接口韧性从简**：axios 超时（默认 10s）+ 幂等 GET 一次指数退避重试，手写 30 行进 mutator，不引 axios-retry 依赖。
6. **视觉回归：playwright 快照 3 张**（首页桌面、首页移动、404），快照以 CI 环境为准生成提交；已知跨平台字体渲染差异风险，任务卡内建基线生成步骤。
7. **a11y 冒烟**：`@axe-core/playwright` 对首页跑一次核心规则集断言，一条 e2e 用例，成本极低。
8. **健康探针**：`public/healthz.txt` 静态文件（部署探针用），零成本。
9. **site 本地 AGENTS.md**：落 `apps/site/AGENTS.md`，把壳架构不变量写成禁止项（禁全量 arco.css、禁 useEffect 拉数、监控必须 env 门控、埋点必须走 facade 等），根 AGENTS.md 18-21 不动、本地文件做补充细化。

---

## 3. 目标结构（仅 apps/site 内新增/变更）

```
apps/site/
  AGENTS.md                     # 新增：壳架构约束（本方案核心交付物之一）
  README.md                     # 新增：快速上手 + 配置项索引
  config/budgets.json           # 新增：性能预算配置坑
  scripts/check-budgets.mjs     # 新增：预算断言脚本
  modern.config.ts              # 变更：transformImport、bundleAnalyze 开关、CSP 联动 RUM origin
  src/
    config/
      env.ts                    # 新增：zod env 校验 + 类型化导出
      features.ts               # 新增：特性开关（rum/tracking/retry）
      site.ts                   # 新增：站点元信息配置坑（现 constants/ 迁入）
      tracking-events.ts        # 新增：埋点事件注册表
      rum.ts                    # 已有，改为读 env.ts
    tracking/
      index.ts                  # 新增：facade（track/trackPageView）
      sinks.ts                  # 新增：console / RUM / sendBeacon 三 sink
    components/
      error-boundary.tsx        # 新增：抄 admin，catch 时上报 tracking
      page-loading.tsx          # 新增：骨架屏占位
      site-image.tsx            # 新增：图片包装（强制尺寸/懒加载/decoding）
    api/client.ts               # 变更：超时 + 幂等重试 + 错误上报挂钩
    routes/layout.tsx           # 变更：装配 ErrorBoundary + tracking 初始化（阶段 5 统一装配，避免多卡抢单文件）
    routes/loading.tsx          # 新增：路由级 loading 约定示例
  public/healthz.txt            # 新增
  tests/                        # 补强：layout/page/404/error-boundary/tracking/env 用例 + 覆盖率门禁
  .env.example                  # 补全所有配置坑注释
```

---

## 4. 分阶段计划与并行编排

**编排模型**：planner（高级指挥）→ 任务卡（文件所有权清单 + 验收命令 + 禁止事项）→ coding-agent 执行 → 阶段门禁 `pnpm verify`。

**单点与并行上限**：

- `modern.config.ts`、`src/routes/layout.tsx`、`package.json`/lockfile 是单点——依赖集中在阶段 1 一次装完，layout.tsx 装配集中在阶段 5；
- 峰值并行 **2**（阶段 2∥3、阶段 6∥7），低于环境实测上限 3，无排队风险；
- 全阶段只在 apps/site 内作业 + 根 CI 文件，与其他应用零冲突。

### 阶段 1：依赖与构建链（1 agent）

| 任务卡 | 内容                                                                                                                                                           | 验收                                                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1.1    | apps/site 加依赖：`zod`、`web-vitals`、devDeps `@vitest/coverage-v8`、`@axe-core/playwright`（版本 `npm view` 钉 ^ 最新）；根 `pnpm install`（lockfile 独占）  | `pnpm install --frozen-lockfile` 通过                                             |
| 1.2    | modern.config.ts：`source.transformImport` arco 双规则（组件 + icon）；`performance.bundleAnalyze` 由 env `ANALYZE` 门控；package.json 加 `build:analyze` 脚本 | `pnpm --filter @monorepo-template/site build` 绿；`ANALYZE=true` 构建产出报告文件 |

### 阶段 2：Arco 按需加载收口（1 agent，依赖 1）

| 任务卡 | 内容                                                                                                                                                  | 验收                                                                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1    | 删除 layout.tsx 的全量 `arco.css` import；清 CSS 变量硬编码兜底（主题 token 配置坑：`site-theme.ts` 集中，ConfigProvider 引用）；clean build 对比产物 | CSS 总产物 **< 60 kB raw**（原 562 kB）；`pnpm verify` 全绿（含双端视口 e2e 回归）；clean build 后 dist html 含 CSP meta（顺带复验差距表 #14） |

### 阶段 3：配置体系收口（1 agent，依赖 1；与阶段 2 并行）

| 任务卡 | 内容                                                                                                                                                                                                      | 验收                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 3.1    | `src/config/env.ts`（zod schema：SITE_API_BASE/RUM__/TRACK__ 全量可选、带默认值与注释）；`features.ts`；`site.ts`（constants/ 迁入并删旧文件，引用点全改）；`.env.example` 补全；删 `src/config/.gitkeep` | `pnpm --filter @monorepo-template/site typecheck && test` 绿；env 非法时 SSR 启动报明确错误 |

### 阶段 4：埋点与监控增强（1 agent，依赖 3；不改 layout.tsx）

| 任务卡 | 内容                                                                                                                                                      | 验收                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 4.1    | `src/tracking/` facade + 三 sink + 事件注册表；web-vitals 接入（CLS/LCP/INP 上报进 sink）；RUM sink 接 `@arms/rum-browser` 自定义事件 API；未配置时 no-op | 单测：facade 分发、no-op、sink 失败不冒泡（六类边界） |
| 4.2    | modern.config.ts：CSP `connect-src` 在 `RUM_ENDPOINT`/`TRACK_ENDPOINT` 存在时自动并入其 origin                                                            | 构建产物 CSP meta 含 RUM origin（设 env 构建验证）    |

### 阶段 5：稳定性装配（1 agent，依赖 4；独占 layout.tsx）

| 任务卡 | 内容                                                                                                                                                                                                          | 验收                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 5.1    | `components/error-boundary.tsx`（抄 admin，catch 上报 tracking）；layout.tsx 装配：ErrorBoundary 双层（根 + 页面）+ tracking 初始化 + ConfigProvider theme；`routes/loading.tsx` 骨架约定；`page-loading.tsx` | 单测：ErrorBoundary 捕获渲染 + 上报断言；e2e 全绿 |
| 5.2    | `api/client.ts`：超时 10s + 幂等 GET 一次退避重试 + 错误上报挂钩；`public/healthz.txt`；`site-image.tsx` 并替换现有 `<img>`                                                                                   | 单测：重试只对幂等 GET、超时生效、上报调用        |

### 阶段 6：测试强化（1 agent，依赖 2-5；与阶段 7 并行）

| 任务卡 | 内容                                                                                                                               | 验收                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 6.1    | vitest 覆盖率门禁（`@vitest/coverage-v8`，src 排除 generated，阈值 80% 起）；补齐 layout/page/404/tracking/env/error-boundary 用例 | `pnpm --filter @monorepo-template/site test -- --coverage` 达阈值 |
| 6.2    | playwright 视觉回归 3 张快照（首页桌面/移动、404）+ axe a11y 冒烟 1 条                                                             | CI 环境生成基线快照提交；`pnpm test:e2e` 绿                       |

### 阶段 7：文档收口（1 agent，依赖 2-5；与阶段 6 并行）

| 任务卡 | 内容                                                                                                                                                                                                                                                           |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1    | **apps/site/AGENTS.md**：壳架构不变量（禁全量 arco.css / 禁 useEffect 拉数 / 监控埋点必须 env 门控且走 facade / ErrorBoundary 不得拆除 / 主题只改 site-theme.ts / 预算只改 budgets.json / 新增依赖需 planner 评审）；目录地图；与根 AGENTS.md 18-21 的从属关系 |
| 7.2    | docs/site.md 增补：tracking/性能预算/稳定性三节；apps/site/README.md（配置项索引表）；docs/quality-and-site-plan.md 追加本次交付记录                                                                                                                           |

### 阶段 8：总收口（1 agent，依赖 6+7）

| 任务卡 | 内容                                                                                                                                                                    | 验收                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 8.1    | 全量 `pnpm verify`（含 e2e + 覆盖率门禁 + 预算脚本）；CI 工作流加 site 预算检查步骤（`.github/workflows/ci.yml`）；联通冒烟（起 server + site dev，curl 首页 SSR HTML） | verify exit 0；人为超预算时预算脚本红（自验后回滚） |

### 排期与并行图

```
阶段1 (依赖+构建链, 1人)
  ├─► 阶段2 (Arco 按需, 1人) ──────┐
  └─► 阶段3 (配置体系, 1人) ──► 阶段4 (埋点监控, 1人) ──► 阶段5 (稳定性装配, 1人) ─┤
                                                                                 ├─► 阶段6 (测试, 1人) ─┐
                                                                                 └─► 阶段7 (文档, 1人) ─┤
                                                                                                         ▼
                                                                                              阶段8 (总收口, 1人)
```

- 估算：阶段 1 ≈ 0.5、2 ≈ 0.5、3 ≈ 0.5、4 ≈ 1、5 ≈ 1、6 ≈ 1、7 ≈ 0.5、8 ≈ 0.5 人日；合计 **5~5.5 人日**，并行后约 **2.5 日历天**。
- 提交策略：每阶段一笔 commit（Conventional Commits），阶段 1 单独携带 lockfile。

---

## 5. 风险清单

| 风险                                                                     | 等级 | 缓解                                                                                          |
| ------------------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------------- |
| Arco 按需样式漏根变量/全局重置，组件样式回归                             | 中   | 任务卡 2.1 内建双端视口 e2e 回归 + 视觉基线（阶段 6 快照兜底）；必要时补引 `es/style/` 根 css |
| 视觉回归快照跨平台字体差异误报                                           | 中   | 基线以 CI 容器为准生成提交；本地不符用 CI 快照覆盖；仅 3 张控制维护面                         |
| 埋点 facade 过度设计                                                     | 低   | 任务卡约束 API 表面（track/trackPageView 两方法 + 三 sink），禁止引入事件队列/离线持久化      |
| RUM/TRACK endpoint 进 CSP 后 connect-src 变长、构建期 env 缺失导致误放行 | 低   | 仅 env 存在时并入；任务卡 4.2 有构建产物断言                                                  |
| 新依赖（zod/web-vitals/coverage/axe）拖大产物                            | 低   | zod/web-vitals 合计 < 15 kB gzip；coverage/axe 是 devDep 不进产物；预算门禁直接兜底           |
| coverage 阈值对壳代码误伤（generated 混入）                              | 低   | coverage include 排除 `src/api/generated` 与 `controllers.gen.ts`                             |

---

## 6. 后续阶段（明确不在本次）

1. **Lighthouse CI**（性能分门禁）与真实 RUM 告警规则配置（需线上 endpoint）；
2. **CDN/部署层缓存策略**（HTML/静态资源 Cache-Control、assetPrefix）——属部署议题；
3. **CSP nonce 化**（去 unsafe-inline，modern.config.ts 已留 TODO）；
4. **业务级埋点规范**（事件命名空间、字段字典）——等有真实业务再定；
5. **PWA / 离线兜底**（如活动页场景需要再立项）。

---

## 7. 执行记录

| 阶段            | 状态      | 提交    | 备注                                                                                          |
| --------------- | --------- | ------- | --------------------------------------------------------------------------------------------- |
| 0 方案评审      | ✅ 本文档 | —       | 2026-09-19，基于全量现状盘点                                                                  |
| 1 依赖与构建链  | ✅ 完成   | fa24ee6 | 4 依赖钉版 + transformImport（camelToDashComponentName:false）+ ANALYZE 门控                  |
| 2 Arco 按需加载 | ✅ 完成 | cced642 | 删全量 arco.css+site-theme.ts;CSS 562→82kB(-85%);e2e 绿;#14 CSP 配置期 NODE_ENV 修复 |
| 3 配置体系      | ✅ 完成   | a2fcd56 | zod env/features/site 迁入；42 用例全绿；constants/ 留 2 行 shim 待 P2（layout.tsx 互斥）删除 |
| 4 埋点与监控    | ✅ 完成 | a03acb8 / 10fbb4f | tracking facade+web-vitals;CSP 联动 origin 实证 |
| 5 稳定性装配    | ✅ 完成 | e2e7979 / f61fec2 | 双层 ErrorBoundary+loading;client 超时/重试/上报 |
| 6 测试强化      | ✅ 完成 | 2b3c85f / d88c422 | 覆盖率 98%;视觉回归 3 快照+axe 冒烟 |
| 7 文档收口      | ✅ 完成 | 6d78ec7 / ab34a41 | AGENTS.md;README 索引;site.md 三节;交付记录 |
| 8 总收口        | ✅ 完成 | 06930e3 / 86a8c29 / 68ad9d6 | budgets+ci 门禁(自验红→绿);联通冒烟;根 verify 0 |
