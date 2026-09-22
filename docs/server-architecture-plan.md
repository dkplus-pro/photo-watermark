# server 架构优化方案：约束规范 + 依赖修正 + 装配收口

> 状态：**待评审**（方案记录，未开始执行）
> 日期：2026-09-19
> 范围：`apps/server` 内部架构优化。目标二合一：**① 落地 `apps/server/AGENTS.md` 约束规范 + 可执行的架构守护测试，使后续修改不破坏架构；② 修掉现状探查出的依赖越层、装配重复、事务缺口等具体病灶**。
> 前置事实：本文所有现状数据均来自对 `apps/server` 的逐文件实测（非生成代码 8765 行，4 份 gen 生成物另 3248 行）。

---

## 0. TL;DR

| 项         | 结论                                                                                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 核心机制   | **规范（apps/server/AGENTS.md）+ 守护测试（import 方向 / 权限注册表对账，CI 必过）**双轨约束架构                                                                                                                      |
| 主要病灶   | 6 处依赖越层（handler→repo 等）、main.go 三条公开链逐字符重复、admin Handler 单体（54 方法/10 参注入/零测试）、service 层事务缺口、`MatchRoutePermission` cutset 误用、migrate 含 SQLite 专用 SQL（MySQL 下生产阻断） |
| 不做项     | repo 接口化、契约驱动权限注册表、handler 全量业务测试、领域垂直分包（理由见 §3.3）                                                                                                                                    |
| 工作量     | 约 **4~5.5 人日**；planner 编排 + coding-agent 执行，**峰值并行 3**，并行后约 **2 日历天**                                                                                                                            |
| 并行度依据 | 实测执行池：`coding-agent` 与 `coding-agent-2` 两个池各 2 并发，混合峰值 4；瞬时错误（captcha/限流）时 planner 重试或换池降级                                                                                         |

---

## 1. 现状关键事实（优化依据，全部为实测）

| #   | 事实                                                                                                                                                                                                                                                                                               | 位置                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| F1  | admin `Handler` 单体：10 个位置参数注入（7 service + media + uploads + logger），54 个方法摊在 11 个文件共 1462 行，**零测试**；8 个包级 helper 堆在 `users.go` 被 9 个文件跨文件引用                                                                                                              | `internal/handler/handler.go`          |
| F2  | **6 处依赖越层**：handler→repo（5 个文件，因 repo 哨兵错误 14 处 + `repo.DictEntry` 出现在 service 入参 + `media.GetFile` 返回 `repo.File`）；oplog→httpapi（为取 ctx 身份/IP）；httpapi→config（swagger 只要一个配置 struct）；repo→config（`Open(cfg)`）；uploads→storage（仅为 `NewUUID` 工具） | `go list` 实测                         |
| F3  | 业务层双入口：`media`/`uploads` 是不挂在 `internal/service` 下的独立领域服务包，handler 直接持有                                                                                                                                                                                                   | main.go:135-136                        |
| F4  | 事务只在 repo（10 处）；service 多步写非原子：`RoleService.UpdatePermissions` 在 **service 层直接拼 GORM 查询**（全 service 唯一一处）且校验与写入间有 TOCTOU 窗口；`media.Upload/Delete` 是 saga 手工补偿                                                                                         | service/roles.go:156、media/service.go |
| F5  | 权限注册表 43 条与 admin.yaml 36 个 path **纯人工对齐**，无任何自动化校验；漏一条 = 该端点静默降级为"登录即可访问"；`MatchRoutePermission` 用 `strings.Trim` cutset 裁剪路径（语义脆弱）；契约无任何 `x-*` 扩展字段                                                                                | httpapi/permission.go                  |
| F6  | main.go 225 行：3 条公开中间件链逐字符重复 ×3；权限同步对账逻辑 28 行内联在 main；8 处 `os.Exit(1)` 跳过 defer（访问日志不刷盘）；`go uploadsService.StartCleaner` 是冗余 goroutine（内部已自旋）                                                                                                  | cmd/server/main.go                     |
| F7  | swagger 硬编码 admin+site 双 spec，app/h5 契约已存在但未注册，新增受众需改 Go 代码 + config 字段                                                                                                                                                                                                   | httpapi/swagger.go、config.go:52-57    |
| F8  | `repo/migrate.go` 的 `dropLegacyOperationLogs` **每次启动执行 SQLite 专用原生 SQL**，config 允许 MySQL driver——切 MySQL 即启动报错（生产阻断级）                                                                                                                                                   | repo/migrate.go:43-58                  |
| F9  | 死代码/平行模型/注释错位：`types.MenuItem/MenuUpsert/AuthMenuNode` 全仓零引用；`types.Dict/DictEntry` 与 `repo.Dict/DictEntry` 平行互转；dict.go:35/config.go:21 注释张冠李戴                                                                                                                      | internal/types/user.go 等              |
| F10 | 测试覆盖：handler 根目录 **0%**、auth/oplog/types/cmd **无测试文件**、repo 5%、httpapi 24.3%、service 61.5%；测试手法为 sqlite `:memory:` 真库（非 mock），工作良好                                                                                                                                | `go test -cover` 实测                  |
| F11 | oplog 失败埋点覆盖不均：dict 的删除/更新/状态失败路径不记 `Failed`（40 处埋点中的缺口）                                                                                                                                                                                                            | service/dict.go                        |
| F12 | uploads 的 `PutChunk/Status/Abort` 不接 ctx；会话磁盘状态与 DB 无对账（仅 TTL 清目录）                                                                                                                                                                                                             | uploads/service.go                     |

---

## 2. 优化点清单（回答"还有什么优化点"）

### 2.1 本轮做（进入分阶段计划）

| #   | 优化点                                                                                                                                                                                                                                                                                                                   | 对应事实  | 收益                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------- |
| O1  | **apps/server/AGENTS.md 架构约束规范**：依赖方向矩阵、受众接入步骤、事务规则、oplog 规则、错误转译边界、测试纪律、文件纪律                                                                                                                                                                                               | 用户点名  | 约束随代码目录走，任何 agent 进入 server 即加载           |
| O2  | **架构守护测试**：① import 方向白名单检查（解析 `go list -json`）；② 权限注册表 ↔ admin.yaml 对账（kin-openapi 读契约，断言每个非公开端点有注册条目、每条注册条目在契约中存在）；③ `MatchRoutePermission` cutset 修复 + 匹配测试                                                                                         | F2/F5     | 把"漏权限 = 静默降级""越层依赖"从评审口头约束变成 CI 红灯 |
| O3  | **依赖方向修正**：service 转译 repo 哨兵（handler 不再 import repo）；`ReplaceEntries` 入参改 service 层类型；`media.GetFile` 不透出 repo.File；身份/IP 提取下沉新包 `internal/reqctx`（oplog、httpapi 共同依赖）；`RegisterSwagger` 改值参数（脱 config）；`repo.Open` 用 repo 自有 Config；`NewUUID` 挪 `internal/uid` | F2        | 依赖矩阵从"文档说法"变成"编译事实"                        |
| O4  | **main.go 装配收口**：`run() error` 收敛退出路径（defer 生效）；受众表驱动注册 + `publicChain` helper（消 21 行重复）；权限同步对账抽函数；去冗余 `go`；swagger 泛化多 spec 并登记 app/h5                                                                                                                                | F6/F7     | 新增受众 = 表项 + handler 包，不再抄链                    |
| O5  | **admin Handler 拆分**：per-resource struct（`UsersHandler` 等，各自只注入所需 service），`Handler` 改为内嵌组合（方法提升满足 `gen.ServerInterface` 断言不动）；helper 归位 `helpers.go`；构造改选项/分资源                                                                                                             | F1        | 单资源改动爆炸半径从 54 方法降到本资源；handler 可单测    |
| O6  | **事务与一致性**：`UpdatePermissions` 的 GORM 查询挪 repo 并整体入 tx（消 TOCTOU）；media saga 补偿路径补测试；`dropLegacyOperationLogs` 加方言守卫（修 F8 生产阻断）；dict 失败路径补 oplog.Failed                                                                                                                      | F4/F8/F11 | 消除已确认的一致性窗口与启动阻断                          |
| O7  | **清理**：types 菜单死代码删除；`types.Dict/DictEntry` 与 repo 模型收敛（service 出参统一走 types，handler 只见 types+gen）；错位注释修复                                                                                                                                                                                | F9        | 减一套平行模型                                            |
| O8  | **关键路径测试补强**：auth（签名/校验/过期/alg 混淆）、httpapi（PermissionCheck/WriteJSON/信封）、oplog                                                                                                                                                                                                                  | F10       | 认证/授权/审计三条安全链必须有测试                        |

### 2.2 本轮不做（列入后续，附理由）

| 优化点                                                   | 理由                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| repo 接口化 / mock 测试                                  | sqlite `:memory:` 真库测试已工作良好且更真实；60+ 包级函数接口化改动面大、收益低 |
| 契约驱动权限注册表（`x-permission` 扩展 + 生成）         | O2 的对账测试已把漂移变红灯；生成是进一步优化，待契约量再涨后做                  |
| handler 54 方法全量业务测试                              | 成本大；改为 AGENTS.md 规则约束"新增端点必须带 handler 测试"，存量按资源滚动补   |
| 领域垂直分包（internal/{user,role,...}）                 | 即旧方案阶段 3，爆炸半径大；本轮 O5 先解决单体内聚，垂直分包待 MVP 后再审        |
| uploads ctx 补齐 / 会话-DB 对账                          | 小项，随下一个 uploads 功能迭代顺带                                              |
| config 补硬编码项（ChunkSize/TTL/媒体上限/ConfigGroups） | 行为中性，列 backlog                                                             |
| C 端用户体系                                             | 见 docs/monorepo-expansion-plan.md §7                                            |

---

## 3. 目标架构与约束规范要点

### 3.1 依赖方向矩阵（写进 apps/server/AGENTS.md + 守护测试强制）

| 包                                   | 允许依赖（internal 内）                      | 禁止                                  |
| ------------------------------------ | -------------------------------------------- | ------------------------------------- |
| handler（各受众）                    | httpapi、service、media、uploads、types、gen | **repo**、config、其他受众 handler    |
| service                              | repo、types、auth、oplog、reqctx             | handler、httpapi、media、uploads      |
| media                                | repo、storage、oplog、reqctx                 | service、handler、httpapi             |
| uploads                              | media、storage、uid                          | repo（会话不建表，现状保持）、handler |
| repo                                 | （无 internal 依赖，自带 Config）            | service、handler、httpapi、config     |
| httpapi                              | auth、reqctx                                 | config、handler、service、repo        |
| oplog                                | repo、reqctx                                 | httpapi                               |
| reqctx / uid / types / auth / config | （叶子包，无 internal 依赖）                 | 任何 internal 包                      |
| gen/*                                | （无 internal 依赖）                         | 禁止手改（CI 漂移门禁已有）           |

**业务层定义**（消除 F3 的歧义）：业务层 = `service`（后台管理域）+ `media` + `uploads`（文件域）三个领域服务包；handler 只允许依赖业务层，不得 import repo。

### 3.2 apps/server/AGENTS.md 大纲（任务卡 1.1 的内容依据）

1. 分层与依赖方向矩阵（§3.1 表格原文）；
2. 新受众接入步骤（契约 → oapi cfg → gen → handler 子包 → main 受众表 → 网关前缀），公开链复用 `publicChain`；
3. 错误处理：哨兵错误转译边界（repo 哨兵不得出 repo 所属业务包；handler 只判 service/业务包哨兵）；响应只走 `httpapi.WriteJSON/WriteError`；
4. 事务规则：多步写必须在单个 repo tx 内聚合，或显式 saga + 补偿并在注释中声明；禁止 service 层直接拼 GORM；
5. oplog 规则：写操作成功/失败都埋点（action 形如 `资源.动作`），查询不埋点，埋点不参与业务 tx；
6. 权限规则：新增 admin 端点必须同步 RoutePermissions 条目（守护测试强制），公开端点清单显式列举；
7. 测试纪律：六类边界（空值/零值/越界/权限缺失/网络失败/非法状态迁移）；新增端点必须带 handler 测试；守护测试不得加豁免；
8. 文件纪律：单文件 ≤400 行、一资源一文件、生成物禁改、main.go 只做装配（启动逻辑超 300 行拆 bootstrap）。

### 3.3 守护测试设计（任务卡 1.2 的实现要点）

- 位置：`internal/archguard/arch_test.go`（独立包，只读检查）。
- import 方向：`os/exec` 跑 `go list -json ./internal/...`，按 §3.1 矩阵断言；**豁免清单机制**——现状 6 处越层登记为豁免（每条注明 F 编号），阶段 2 收口时清零（验收硬性要求）。
- 权限对账：kin-openapi（oapi-codegen 已引入同族依赖）加载 `../../../openapi/admin.yaml`，遍历 paths；公开端点清单（healthz、login）显式跳过；双向断言（契约→注册表防漏、注册表→契约防幽灵）。
- `MatchRoutePermission`：先补匹配单测（含 `{id}` 通配、段数不等、前后缀字符集误吃用例）暴露 cutset 问题，再修复为 `TrimPrefix` + 逐段比较。
- go.mod 变动：kin-openapi 从间接转直接依赖，go mod tidy——**该任务卡独占 go.mod/go.sum 修改权**。

---

## 4. 分阶段计划与并行编排

**编排模型**：planner（高级指挥）→ 任务卡（文件所有权清单 + 验收命令 + 禁止事项）→ coding-agent（执行）→ 阶段门禁。

**单点与并行上限**：

- Go 整模块编译 → 改同一批包的任务必须串行；
- `go.mod/go.sum` 任意时刻只能一个 agent 写（仅任务卡 1.2 需要）；
- `main.go` 是装配单点（仅阶段 3 与阶段 4 的签名适配触碰，严格串行）；
- 实测执行池：`coding-agent` 与 `coding-agent-2` 是两个独立 agent 池，各 2 并发，混合峰值 4；瞬时错误（`captcha verify failed` / 并发限流）时 planner 重试或换池执行。本方案任务卡的**峰值需求为 3**（阶段 4∥5 同波、阶段 6 三路），在 4 槽位下有冗余，瓶颈是依赖结构（go.mod / main.go 单点、Go 整模块编译）而非 agent 预算，故不随槽位增加压缩排期。
- 每阶段门禁：`go build ./... && go vet ./... && go test ./...`；阶段 2/3/4 结束各跑一次根 `pnpm verify`。

### 阶段 1：约束规范与守护门禁（并行 2）

| 任务卡 | 内容                                                                                       | 所有权                                                    | 验收                                                    |
| ------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------- |
| 1.1    | 写 apps/server/AGENTS.md（按 §3.2 大纲）；根 AGENTS.md 规则 11-14 区加一行指向             | 仅两个 md 文件                                            | prettier 过；规则编号不重排                             |
| 1.2    | 守护测试（按 §3.3）：import 方向（含豁免清单）+ 权限对账 + MatchRoutePermission 修复与测试 | internal/archguard/、httpapi/permission.go、go.mod/go.sum | `go test ./internal/archguard/` 绿；cutset 用例由红转绿 |

> 两卡文件不相交；1.2 独占 go.mod。

### 阶段 2：依赖方向修正（并行 2 → 1；依赖阶段 1）

| 任务卡 | 内容                                                                                                                                                                                                               | 所有权                                                                                                 | 验收                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 2.1    | 基础包修正：新建 internal/reqctx（身份/IP 提取下沉）、internal/uid（NewUUID 迁入）；RegisterSwagger 改值参数脱 config；repo.Open 改自有 Config 类型（main 适配暂留本卡）；dropLegacyOperationLogs 加方言守卫（F8） | reqctx/、uid/、oplog/、httpapi/swagger.go、repo/db.go、migrate.go、storage/、main.go（仅 Open 调用行） | go build+vet+test 绿；import 矩阵中新包为叶子 |
| 2.2    | service 边界：repo 哨兵转译为 service 哨兵（ErrUserNotFound 等 5 类）；`ReplaceEntries` 入参改 service 类型；`media.GetFile` 改返 media 自有类型；types 死代码删除 + Dict 平行模型收敛                             | service/、media/、types/                                                                               | go build+vet+test 绿                          |
| 2.3    | handler 越层清理（依赖 2.2）：5 文件去 repo import 改判 service 哨兵；helper 归位不动（留阶段 4）；错位注释修复；**archguard 豁免清单清零**                                                                        | handler/ 根目录 11 文件、archguard 豁免表                                                              | 豁免清零后守护测试仍绿；verify 全绿           |

### 阶段 3：main.go 装配收口（串行 1；依赖阶段 2）

| 任务卡 | 内容                                                                                                                                                                                                                               | 验收                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 3.1    | `run() error` 收敛（os.Exit 只在 main 最后一层，defer 生效）；受众表驱动注册 + `publicChain` helper；权限同步对账抽 `bootstrapPermissions`；去冗余 `go StartCleaner`；swagger 泛化为 spec 列表并登记 app/h5（config 增加对应字段） | go build+vet+test 绿；`curl /swagger/` UI 列出 4 份 spec；pnpm verify 全绿 |

### 阶段 4：admin Handler 拆分（并行 1；依赖阶段 3，与阶段 5 并行）

| 任务卡 | 内容                                                                                                                                                                                                                                                               | 验收                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 4.1    | 11 个资源文件改为 per-resource struct（各自只注入所需 service）；`Handler` 改内嵌组合（方法提升，`var _ gen.ServerInterface` 断言保留）；`New` 改分资源构造/选项结构体；users.go 的 8 个 helper 挪 `helpers.go`；main.go 调用点适配（本卡拥有 main.go 一行修改权） | go build+vet+test 绿；54 方法断言通过；verify 全绿 |

### 阶段 5：事务与一致性（并行 1；依赖阶段 2，与阶段 4 并行，文件不相交）

| 任务卡 | 内容                                                                                                                 | 所有权                                             | 验收                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| 5.1    | `RoleService.UpdatePermissions` 的权限校验查询挪 repo 并与写入同 tx（消 TOCTOU）；`UserService.Create` 查重评估入 tx | service/roles.go、repo/role.go、repo/permission.go | 新增 tx 行为测试绿                   |
| 5.2    | media saga 补偿路径测试（Upload 中途失败不落库 / Delete 部分失败的语义固化）；dict 失败路径补 oplog.Failed           | media/、service/dict.go                            | 新测试绿；oplog 测试断言失败记录落库 |

### 阶段 6：测试补强与收口（并行 3；依赖阶段 4+5）

| 任务卡 | 内容                                                                                                          | 并行                   |
| ------ | ------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 6.1    | internal/auth 测试：签名/校验/过期/错误 secret/alg 混淆拒绝                                                   | 3 路并行（文件不相交） |
| 6.2    | internal/httpapi 测试：PermissionCheck（命中/越权/未登录/未注册路由）、WriteJSON/WriteError 信封形态          | ↑                      |
| 6.3    | internal/oplog 测试 + 文档同步（docs/server.md 按新架构修订；apps/server/AGENTS.md 若与最终实现有出入则对齐） | ↑                      |
| 6.9    | 收口：根 `pnpm verify` 全绿后 planner 提交                                                                    | 1（planner）           |

### 排期图

```
阶段1 (1.1 ∥ 1.2, 2 并行)
   │
阶段2 (2.1 ∥ 2.2, 2 并行) → 2.3 (1)
   │
阶段3 (3.1, 1 串行, main.go 单点)
   │
   ├─► 阶段4 (4.1)  ─┐
   └─► 阶段5 (5.1 ∥ 5.2) ─┤   4 与 5 文件不相交,同波 3 并行
                         ▼
              阶段6 (6.1 ∥ 6.2 ∥ 6.3, 3 并行) → 6.9 收口
```

- 估算：阶段 1 ≈ 0.5 人日；阶段 2 ≈ 1~~1.5；阶段 3 ≈ 0.5；阶段 4 ≈ 1；阶段 5 ≈ 0.5~~1；阶段 6 ≈ 0.5~~1。合计 **4~~5.5 人日，并行后约 2 日历天**。

---

## 5. 风险清单

| 风险                                                      | 等级 | 缓解                                                                                                           |
| --------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| 重构期行为回归（54 个 admin 端点零 handler 测试）         | 中   | 每阶段 go test + verify 门禁；playwright e2e 兜底管理后台主链路；阶段 4 拆分只动结构不动逻辑（方法体逐字搬运） |
| 守护测试豁免清单被遗忘（永久豁免 = 门禁失效）             | 中   | 阶段 2.3 验收硬性要求豁免清零；AGENTS.md 写明"守护测试不得加豁免"                                              |
| kin-openapi 转直接依赖引入 go.mod 变动                    | 低   | 任务卡 1.2 独占 go.mod；`go mod tidy` 后 verify 兜底                                                           |
| reqctx 下沉波及 oplog/httpapi/service 三方调用链          | 中   | 2.1 独立任务卡先落地，2.2/2.3 依赖其后                                                                         |
| main.go 是装配单点，阶段 3/4 串行排队                     | 低   | 排期已串行；阶段 4 只改 New 调用一行                                                                           |
| SQLite 方言守卫改动影响现有迁移                           | 低   | 守卫按 driver 分发，SQLite 路径行为不变；repo/migrate_test.go 已有测试兜底                                     |
| site e2e 移动视口用例的工具链固有偶发（rsbuild 已知问题） | 低   | 与本方案无关；CI retries 缓解，根治另立项                                                                      |

---

## 6. 执行记录

| 阶段                 | 状态      | 提交                        | 备注                                                                                    |
| -------------------- | --------- | --------------------------- | --------------------------------------------------------------------------------------- |
| 0 方案评审           | ✅ 本文档 | —                           | 2026-09-19                                                                              |
| 1 约束规范与守护门禁 | ✅ 完成   | 35b4f60 / 26302ff           | S1.1 AGENTS.md 8 节规范；S1.2 守护测试（import 矩阵 4 条豁免 + 契约对账 + cutset 修复） |
| 2 依赖方向修正       | ✅ 完成   | e0b6f5a / 1bcc157 / 9c51a4c | 2.1 基础包下沉；2.2 哨兵转译+Dict 收敛；2.3 handler 越层清零+豁免清零                   |
| 3 main.go 装配收口   | ✅ 完成   | 7c2923a                     | run() 收敛+受众表+bootstrapPermissions+swagger 泛化 4 spec；本地起服冒烟通过            |
| 4 admin Handler 拆分 | ✅ 完成   | 90a1026                     | per-resource struct + 内嵌组合；登录联通冒烟通过                                        |
| 5 事务与一致性       | ✅ 完成 | 5c016e0 / 2161481 | tx 内查重;media saga 补偿测试;dict 失败埋点 |
| 6 测试补强与收口     | ✅ 完成 | e4e4211 / 92cd2a8 / 76a3ea4 | auth/httpapi/oplog 测试;文档对齐;根 verify exit 0 |
