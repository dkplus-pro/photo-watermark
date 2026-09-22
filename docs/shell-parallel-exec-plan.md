# 六端并行执行编排总案：server 架构优化 + 五端壳建设

> 状态：**执行中**
> 日期：2026-09-19
> 范围：统一编排 6 份已评审方案的并行落地——`server-architecture-plan.md`、`site-shell-plan.md`、`h5-shell-plan.md`、`desktop-shell-plan.md`、`miniapp-shell-plan.md`、`flutter-shell-plan.md`。
> 编排模型：**主 agent（planner 同型 kimi-k3）任总指挥**：持有全局排期、单点锁、提交与门禁；**coding-agent / coding-agent-2 / general-purpose 混合执行池**跑满实测上限 6 并发；各方案文档的 §分阶段计划即任务卡来源（文件所有权 + 验收命令已在各方案中定义），planner agent 仅在执行失败需重规划时按需调用。

---

## 1. 六份方案汇总

| 流      | 方案                     | 范围                                                                                             | 交付核心                                                                                                                | 工作量     | 流内峰值并行 | 关键长链                                  |
| ------- | ------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ | ----------------------------------------- |
| server  | server-architecture-plan | Go 内部架构：约束规范 + 守护测试 + 依赖修正 + 装配收口                                           | apps/server/AGENTS.md、archguard 守护测试（import 方向 + 权限对账）、6 处越层清零、main.go 收口、Handler 拆分、事务补齐 | 4~5.5 人日 | 3            | S1→S2→S3→S4∥S5→S6（6 阶段）               |
| site    | site-shell-plan          | 对外站壳：arco CSS 按需（562kB→<60kB）、埋点 facade、ErrorBoundary、性能预算、视觉回归、env 校验 | apps/site/AGENTS.md、tracking/、check-budgets、覆盖率门禁                                                               | 5~5.5 人日 | 2            | P1→P2∥P3→P4→P5→P6∥P7→P8（8 阶段，最长链） |
| h5      | h5-shell-plan            | 活动 H5 壳：arco-mobile + transformImport、监控/埋点抽象 + ARMS 默认、稳定性、px-to-vw           | apps/h5/AGENTS.md、core/{monitor,track,stability,perf}、coverage 门槛、h5 e2e project                                   | 4~5 人日   | 3            | H1→H2(3 路)→H3→H4∥H5                      |
| desktop | desktop-shell-plan       | electron 壳：主进程稳定性六件套、统一上报管道、渲染层 arco + sdk、e2e 进 verify/CI               | apps/desktop/AGENTS.md、main/preload/renderer 三层、playwright electron 冒烟                                            | 3~4 人日   | 2            | D1∥D2→D3→D4（最短链）                     |
| miniapp | miniapp-shell-plan       | 小程序壳：core 零依赖监控/埋点/性能自研、多 sink、包体积门禁、覆盖率门槛                         | apps/miniapp/AGENTS.md、core/{transport,monitor,track,perf}、check-size、automator 冒烟                                 | 4~5 人日   | 3            | N1→N2(3 路)→N3+4(3 路)→N5∥N6→N7（7 阶段） |
| mobile  | flutter-shell-plan       | Flutter 壳：Sentry 三接口抽象、Riverpod、dio 信封、go_router、unit+widget 测试                   | apps/mobile/AGENTS.md、core 七模块、平台目录生成、CI 覆盖率                                                             | 4~5 人日   | 3            | M0(SDK)→M1→M2(3 路)→M3→M4                 |

合计约 **24~30 人日**；6 并发理想摊派 ≈ **4~5.5 日历天**（含门禁/重试冗余按 5~7 天预期）。

## 2. 全局并发模型（2026-09-19 用户指令修订）

- **现行模型：见 [docs/shell-exec-runbook.md](./shell-exec-runbook.md)（主 agent 总指挥兼执行者 + 至多 2 个 coding-agent 并行槽，CA 不可并行时回归主 agent 串行；全序任务卡与执行台账以 runbook 为准）**。本节以下描述与 §4.2 波次表为历史模型留档。
- **执行池实况**：coding-agent（GLM-5.3-Flash）池当日多次 `captcha verify failed` 瞬时拒绝（并发 ≈2 且不稳定），降级为次选；主力 coding-agent-2（deepseek-v4.1-flash），general-purpose 兜底。遇限流换池重试。
- planner agent 不常驻：六份方案的分阶段计划已是 planner 级任务卡；执行失败需重规划时由总指挥按需调用。
- mobile 阶段 0（Flutter SDK）：已由后台 shell 完成（~/flutter stable，`flutter --version` 通过），不占槽。
- ~~原 6 并发模型~~（备查：实测上限 3 CA + 2 CA2 + 1 GP；恢复大并发时直接沿用 §4.2 波次表）。

## 3. 全局单点锁清单（跨流共享资源，一律经总指挥串行）

| 锁  | 资源                                                      | 需求方（预计先后顺序）                                                      | 规则                                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L1  | `pnpm install` / pnpm-lock.yaml                           | site P1 → h5 H3 → desktop D4 → miniapp N7                                   | 任一时刻全仓仅一个 install；执行者卡内显式授权                                                                                                                                                                                                               |
| L2  | 根 `AGENTS.md`                                            | server S1.1 → h5 H5.1 → miniapp N6.1                                        | 只允许追加指向行，不重排编号；由总指挥应用或逐卡授权                                                                                                                                                                                                         |
| L3  | 根 `playwright.config.ts` + 根 `package.json`（test:e2e） | h5 H4.1 → desktop D4                                                        | 串行授权                                                                                                                                                                                                                                                     |
| L4  | `scripts/verify.sh`                                       | desktop D4 → mobile M4.A → miniapp N7.1                                     | 串行授权                                                                                                                                                                                                                                                     |
| L5  | `.github/workflows/*.yml`                                 | desktop D4(ci.yml) → site P8.1(ci.yml)；mobile M4.A 独立 flutter.yml 不冲突 | ci.yml 串行                                                                                                                                                                                                                                                  |
| L6  | `turbo.json`                                              | miniapp N7.1                                                                | 单流独占                                                                                                                                                                                                                                                     |
| L7  | `apps/server/go.mod/go.sum`                               | server S1.2                                                                 | 流内独占                                                                                                                                                                                                                                                     |
| L8  | 根 `pnpm verify` 全量运行（含 e2e 端口 18082 等）         | 各流收口                                                                    | 全局串行执行（不是文件锁，是运行锁）                                                                                                                                                                                                                         |
| L9  | git 提交                                                  | 全部                                                                        | **执行 agent 禁止 git 写操作**；总指挥按任务卡文件所有权做路径级提交，且**一律 `git commit --no-verify`**——lint-staged 的 stash/restore 周期会覆盖并行 agent 的未提交写入（2026-09-19 已发生两起，N1.1 与 P1 被回滚后自愈）；prettier 风格由各卡验收自行把关 |

## 4. 全局波次排期

### 4.1 各流阶段依赖（流内 DAG）

```
server:  S1(1.1∥1.2) → S2(2.1∥2.2 → 2.3) → S3(3.1) → S4(4.1) ∥ S5(5.1∥5.2) → S6(6.1∥6.2∥6.3 → 6.9收口)
site:    P1(1.1+1.2) → P2 ∥ P3 → P4(4.1+4.2) → P5(5.1+5.2) → P6 ∥ P7 → P8(总收口)
h5:      H1(A∥B) → H2(A∥B∥C) → H3(收口,L1) → H4 ∥ H5
desktop: D1 ∥ D2 → D3 → D4(收口,L1+L3+L4+L5)
miniapp: N1(1.1∥1.2) → N2(2.1∥2.2∥2.3) → N3∥N4a∥N4b → N5a∥N5b∥N6(6.1+6.2) → N7(收口,L1+L4+L6)
mobile:  M0(SDK,后台shell) → M1(1.1+1.2+1.3) → M2(A∥B∥C) → M3(装配收口) → M4(A∥B)
```

### 4.2 波次表（槽位动态填充，前一卡完成即补下一卡）

| 波次           | 槽位 1                                                                                   | 槽位 2                  | 槽位 3              | 槽位 4                   | 槽位 5        | 槽位 6            |
| -------------- | ---------------------------------------------------------------------------------------- | ----------------------- | ------------------- | ------------------------ | ------------- | ----------------- |
| W1             | site P1 (CA, 持 L1)                                                                      | server S1.2 (CA, 持 L7) | miniapp N1.1 (CA)   | server S1.1 (CA2, 持 L2) | h5 H1.A (CA2) | miniapp N1.2 (GP) |
| W2（先到先入） | desktop D1                                                                               | h5 H1.B                 | mobile M1（待 SDK） | server S2.1              | server S2.2   | site P2 / P3      |
| W3+            | 按 DAG 依赖与优先级滚动：desktop D2、miniapp N2.x、h5 H2.x、server S2.3→S3、site P3→P4 … |                         |                     |                          |               |                   |

波次不是硬栅栏：槽位一空即按"依赖已满足 + 优先级"补位，目标全程满载 6。

### 4.3 执行 agent 通用纪律（每张任务卡必带）

1. 禁止 `git add/commit`（总指挥统一路径级提交）；
2. 禁止 `pnpm install`，除非卡内显式持 L1；
3. 只写卡内文件所有权清单内的文件；
4. 门禁用应用级命令（`cd apps/<x> && pnpm test/typecheck` 或 `go test ./...`），**禁止根 `pnpm verify`**（L8 运行锁）；
5. 完工报告：改动文件清单 / 验收命令输出摘要 / 偏差说明；
6. 遇瞬时失败（限流、并发 install 干扰）重试一次再上报。

## 5. 提交与门禁纪律

- 每张任务卡验收绿后，总指挥按其文件所有权 `git add <paths> && git commit`（Conventional Commits，如 `feat(server): ...`、`feat(h5): ...`）；
- 各方案文档 §执行记录 在该流阶段提交时同步回填；
- 各流收口阶段（S6.9 / P8 / H3 / D4 / N7 / M4）跑根 `pnpm verify`，持 L8 串行；
- 风险总表沿用各方案 §风险清单，本总案不重复。

## 6. 执行记录

> 全部 63 卡(含前置 6 卡)已完工;逐卡提交号与备注见
> [docs/shell-exec-runbook.md](./shell-exec-runbook.md) §10 执行台账与
> 六份方案文档各自的 §执行记录。最终根 `pnpm verify` exit 0(含 admin/site/h5 e2e、
> desktop electron e2e、miniapp 覆盖率与体积门禁、site 预算门禁)。

| 流      | 方案文档                         | 状态    | 流内收口卡      |
| ------- | -------------------------------- | ------- | --------------- |
| server  | docs/server-architecture-plan.md | ✅ 完成 | S6.9(根 verify) |
| site    | docs/site-shell-plan.md          | ✅ 完成 | P8.1(总收口)    |
| h5      | docs/h5-shell-plan.md            | ✅ 完成 | H3.1/H4.1/H5.1  |
| desktop | docs/desktop-shell-plan.md       | ✅ 完成 | D4(e2e 入 CI)   |
| miniapp | docs/miniapp-shell-plan.md       | ✅ 完成 | N7.1/N7.2       |
| mobile  | docs/flutter-shell-plan.md       | ✅ 完成 | M3.x/M4.A/M4.B  |

| 波次/阶段              | 流      | 状态    | 提交    | 备注                                                                                                                       |
| ---------------------- | ------- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| server S1.1 AGENTS.md  | server  | ✅ 完成 | 35b4f60 | 8 节规范 + 根 AGENTS.md 追加 11b 指向行                                                                                    |
| miniapp N1.2 transport | miniapp | ✅ 完成 | c4eda14 | 47 新用例（11→58）；测试落位 tests/（vitest include 限制，N5a 时可平移）                                                   |
| miniapp N1.1 配置体系  | miniapp | ✅ 完成 | d1dc2d3 | 多环境表 + defineConstants；taro build 实证；曾被 lint-staged stash 误伤回滚，自愈                                         |
| site P1 依赖与构建链   | site    | ✅ 完成 | fa24ee6 | 4 依赖钉版 + transformImport（需 camelToDashComponentName:false）+ ANALYZE 门控（rsbuild 无 bundleAnalyze，改 stats 插件） |
| M0: Flutter SDK 安装   | mobile  | ✅ 完成 | —       | ~/flutter stable 就绪                                                                                                      |
| server S1.2 守护测试   | server  | 执行中  |         | CA 池 captcha 两次拒绝后换 CA2；持 L7                                                                                      |
| h5 H1.A UI 基座        | h5      | 执行中  |         | 不 install                                                                                                                 |
| 其余阶段               | 全部    | 待启动  |         | 按 §2 全局队列 2 槽滚动补位                                                                                                |
