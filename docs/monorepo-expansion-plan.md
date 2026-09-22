# 多应用扩展方案：新增 mobile / desktop / miniapp / h5

> 状态：**待评审**（方案记录，未开始执行）
> 日期：2026-09-19
> 范围：在 apps/ 下新增 4 个 hello-world 级占位应用（Flutter 手机端、Electron 桌面端、Taro 小程序、Modern.js 活动 H5），openapi 按受众扩展并保持结构清晰，审视 Go 服务能否支撑 6 受众。
> 与前方案关系：已回滚的 `docs/restructure-plan.md`（目录重组方案）**不并入、不复活**；本方案为纯新增。若未来要做目录重组，以旧方案为底稿另行评审。

---

## 0. TL;DR

| 项               | 结论                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 范围             | **纯新增**：现有 `apps/{admin,server,site}`、`openapi/{admin,site}.yaml`、生成物位置一律不动                                                      |
| 契约             | 共 4 份：`admin.yaml`、`site.yaml`、新增 `app/`（flutter+desktop+miniapp 共享的 C 端契约）、`h5/`（活动页契约）；新契约从第一天就是**多文件骨架** |
| 认证             | 占坑期 app/h5 走 site 同款**匿名公开链**；契约预定义 `bearerAuth`、server 链预留 JWTAuth 槽位；C 端用户体系列为后续阶段                           |
| 保真度           | **端到端薄切片**：server 落两个真实 ping 端点，四端各自调通并渲染结果                                                                             |
| Go 架构审视      | **能支撑**。多受众模式已参数化并跑通两次，新增受众是纯增量；摩擦点是 main.go 装配线性增长与 admin Handler 单体（后者是既有债，与本次无关）        |
| openapi 结构审视 | 受众间靠"每受众一契约 + 禁跨契约 `$ref` + 前缀即路由"保持清晰；受众内靠多文件骨架约束膨胀；`admin.yaml`（2060 行）迁移列入触发式后续阶段          |
| CI               | 三个 JS 端全量进 turbo/verify/CI（lint+typecheck+test+build）；flutter 经 flutter-action 进 CI（analyze+test）；新增契约-生成物漂移检查门禁       |
| 工作量           | 约 **5~6 人日**；planner 编排 + coding-agent 执行，**最大并行 4**，并行后日历时间约 **1.5~2 天**                                                  |

---

## 1. 决策记录（逐条对应评审结论）

1. **纯新增，现有结构不动**。不做目录搬迁、不做 api-client 下沉、不做 server 领域化。爆炸半径最小。
2. **契约粒度：C 端三端共享 `app`，H5 独立**。flutter/desktop/miniapp 是同一受众（C 端用户产品，业务接口约 90% 重合），共享一份契约；平台差异（登录方式等）在同一份契约内按端点区分。H5 活动页是短命、公开、匿名只读受众，独立一份。这是对"每个 app 一份 openapi.yaml"的修正：**受众 = 平台族，不是物理应用**。
3. **认证：占坑期匿名，预留槽位**。app/h5 中间件链复制 site 模式（无 JWT）；契约里预定义 `bearerAuth` securityScheme，server 装配时预留 JWTAuth 插入位。C 端用户体系（新用户域、分平台登录、user JWT）**不在本次**。
4. **保真度：端到端薄切片**。server 侧 `GET /api/app/ping`、`GET /api/h5/ping` 走完整生成链（契约 → oapi-codegen → handler → mux 链）；四端各自调用并把返回渲染到 hello world 页面。目的：验证"契约 → 生成 → handler → 客户端"管道在每个新端跑通一次，后续加真实功能就是纯增量。
5. **技术栈与目录约定**（四端统一，与 admin 范式对齐）：

   | 端             | 技术栈                                             | 进 pnpm workspace    |
   | -------------- | -------------------------------------------------- | -------------------- |
   | `apps/mobile`  | Flutter（`flutter create` + Material + `http` 包） | **否**（非 JS 工程） |
   | `apps/desktop` | electron-vite + React                              | 是                   |
   | `apps/miniapp` | Taro 4 + React（编译目标 weapp）                   | 是                   |
   | `apps/h5`      | Modern.js SSR（与 site 同版本 `^3.5.0`）           | 是                   |

   三个 JS 端统一依赖：`zustand`、`lodash-es`、`axios`、`ahooks`、`orval`；统一目录：

   ```
   src/
     api/        # orval 生成物 + client.ts mutator + controllers.gen.ts（与 admin 同范式）
     component/  # 公共组件
     config/     # 公共配置
     consts/     # 公共常量
     hooks/      # 公共 hooks
     store/      # zustand 全局状态
   ```

   测试框架统一 `vitest@^5`（与 admin/site 一致）。

6. **CI：全量含 flutter**。JS 三端进 turbo 全任务（lint / typecheck / test / build），verify 与 CI 自动覆盖；flutter 在 CI 用 `subosito/flutter-action` 跑 `flutter analyze` + `flutter test`；本地 `verify.sh` 对 flutter 条件化（无 SDK 则跳过并提示）。playwright 不加新 e2e project（后续阶段再补）。
7. **契约结构：新契约第一天起多文件骨架**。`oapi-codegen`（kin-openapi）与 `orval`（swagger-parser）均支持跨文件相对 `$ref`，任务卡内含**生成链验证步骤**；若验证失败才引入 redocly bundle 步骤。`admin.yaml` / `site.yaml` 保持单文件不动。

---

## 2. Go 架构审视：能否支撑 6 受众

**结论：能支撑，且新增受众是纯增量。** 依据（实测现状）：

- 多受众模式已参数化并跑通两次：每受众 = 一份契约 → `oapi.<受众>.cfg.yaml` → `gen/<受众>` → `internal/handler/<受众>/` 子包 → main.go 一条独立 mux + 中间件链。admin（54 方法）与 site（1 方法）规模悬殊但都正常运作。
- 受众间隔离是编译期 + 装配期双重保证：各受众 handler 实现各自的 `gen.ServerInterface`（有 `var _ = ...` 编译断言），中间件链独立挂载，admin 链不知道 site 存在。
- 本次新增 app/h5 就是把这个参数化模式再实例化两次，handler 直接返回静态内容，不触碰 service/repo/DB。

**摩擦点与对策**（记录，不阻塞本次）：

| 摩擦点                                               | 现状                              | 对策                                                                                                    |
| ---------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| main.go 装配随受众线性增长                           | 现有 3 条 mux，本次后 5 条        | 受众 >4 时抽 `registerAudience` 辅助函数，列入后续阶段                                                  |
| admin `Handler` 单体（54 方法 / 10 个 service 注入） | 既有债，仅影响 admin 受众内部     | admin 内部领域化是独立议题，与本次无关                                                                  |
| C 端用户认证落地                                     | 目前只有 admin JWT 与匿名两种模式 | 契约已预留 `bearerAuth`；落地时新增 user JWT 中间件 + C 端用户域，插入预留槽位即可                      |
| 拆微服务                                             | 单二进制                          | 维持 multi-audience-contracts 文档的判据：契约先分离，拆服务是"机械抽取"，出现独立部署/扩缩容需求时再做 |

---

## 3. openapi 结构审视：扩展后如何保持清晰

**受众间**（规则不变，沿用 docs/multi-audience-contracts.md）：

- 每受众一份契约、路径带字面量受众前缀（`/api/app`、`/api/h5`），网关按前缀路由与放行；
- **禁止跨契约 `$ref`**；同一能力在另一受众需要时，以裁剪后的 DTO 重新声明；
- 公开契约（site/app/h5）**只加不改**，破坏性变更走前缀替换协商。

**受众内**（本次新增的硬约定，app/h5 从第一天执行）：

```
openapi/app/
  openapi.yaml              # 入口：info / servers / tags / securitySchemes / paths 聚合
  paths/
    ping.yaml               # 每路径一个文件（Path Item Object）
  components/
    schemas/
      ping.yaml             # schema 按域分文件
openapi/h5/
  （同构）
```

入口聚合示例（`openapi/app/openapi.yaml`）：

```yaml
openapi: 3.0.3
info: { title: CMS App API, version: 0.1.0 }
paths:
  /api/app/ping:
    $ref: ./paths/ping.yaml
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT } # 预留，占坑期端点匿名
security:
  - bearerAuth: []
```

**生成链兼容性**：kin-openapi 与 swagger-parser 都解析相对文件 `$ref`，阶段 1 任务卡内含验证步骤（生成成功 + 产物与单文件等价）；验证失败则在 `gen:api` 前加 redocly bundle 步骤（以 bundle 产物为生成输入），这是唯一预案。

**既有债与触发式迁移**：`admin.yaml` 2060 行单文件本次不动；触发条件为**任一契约超 800 行或该受众新增业务域**，届时按上述同构约定迁移，新旧并存无迁移顺序依赖。

**CI 缺口补齐**：现状无任何门禁校验"生成物与契约一致"，本次新增**契约-生成物漂移检查**（CI 中执行 `pnpm gen:api && git diff --exit-code`），见阶段 5。

---

## 4. 目标结构（仅新增部分）

```
apps/
  mobile/                 # Flutter；pubspec 名 cms_mobile；禁止出现 package.json
  desktop/                # @monorepo-template/desktop，electron-vite + React
  miniapp/                # @monorepo-template/miniapp，Taro4 + React（weapp）
  h5/                     # @monorepo-template/h5，Modern.js SSR
openapi/
  admin.yaml              # 不动
  site.yaml               # 不动
  app/  (openapi.yaml + paths/ + components/schemas/)
  h5/   (openapi.yaml + paths/ + components/schemas/)
apps/server/
  oapi.app.cfg.yaml / oapi.h5.cfg.yaml
  gen/app/ / gen/h5/
  internal/handler/app/ / internal/handler/h5/
  cmd/server/main.go      # +2 条匿名 mux 链（复制 site 链形态）
```

**端点定义**（占坑期全部内容）：

| 端点                | 受众                          | 认证 | 响应 data                            |
| ------------------- | ----------------------------- | ---- | ------------------------------------ |
| `GET /api/app/ping` | app（mobile/desktop/miniapp） | 匿名 | `{ "message": "pong from app api" }` |
| `GET /api/h5/ping`  | h5                            | 匿名 | `{ "message": "pong from h5 api" }`  |

响应包络沿用 `{code, message, data, logID}`（server 侧 `WriteJSON`，客户端 mutator 解包）。handler 返回静态内容，不经 service/repo。

**开发期联通方式**（对齐 admin/site 现状）：

- h5：`modern.config.ts` dev proxy → `http://127.0.0.1:18085`，dev 端口 **18082**；
- desktop：electron-vite 渲染层 dev server proxy 同源代理，dev 端口 **18083**；
- miniapp：Taro dev（weapp），`wx.request` 直连 `http://localhost:18085`（开发期微信开发者工具勾"不校验合法域名"）；
- mobile：flutter 直连 `http://localhost:18085`（Android 模拟器用 `10.0.2.2`，写进 README）。

---

## 5. 分阶段计划与并行编排

**编排模型**：planner（高级指挥）→ 任务卡 → coding-agent（执行）→ 阶段门禁。

- 每张任务卡必须自包含：**文件所有权清单 + 验收命令 + 禁止事项**；coding-agent 之间文件所有权互不相交。
- **单点约束**：`pnpm-lock.yaml` 与根配置任意时刻只能一个 agent 写；Go 整模块编译，`main.go` 是装配单点；契约目录内部耦合紧。
- 由此得出**全局最大并行 4**：阶段 3 四端各一个 agent 是峰值；所有 install/gen/verify 收口由单独 agent 串行执行。
- 每阶段结束跑 `pnpm verify`（阶段 5 后含 CI 门禁），绿了才进下一阶段。

### 阶段 1：契约骨架（并行度 1）

| 任务卡 | 内容                                                                                                                                                          | 验收                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1.1    | 新建 `openapi/app/` 与 `openapi/h5/` 多文件骨架（入口 + paths/ping.yaml + components/schemas/ping.yaml），含 `bearerAuth` 预留、ping 端点 `security: []` 覆盖 | `npx @redocly/cli lint openapi/app/openapi.yaml openapi/h5/openapi.yaml` 通过（仅校验，不引入构建依赖） |

### 阶段 2：server 双受众扩展（并行度 1，依赖阶段 1）

| 任务卡 | 内容                                                                                                                                                                                                                | 验收                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 2.1    | 新增 `oapi.app.cfg.yaml` / `oapi.h5.cfg.yaml`，`package.json` 的 `gen:api` 加两行；`gen/app`、`gen/h5` 生成成功——**同时承担跨文件 `$ref` 生成链验证**                                                               | `pnpm --filter @monorepo-template/server gen:api` 成功，产物含 `ServerInterface` 与 `Ping` 方法 |
| 2.2    | `internal/handler/app/`、`internal/handler/h5/`：Ping handler 返回静态 message，带编译期 `var _ ServerInterface` 断言；`main.go` 挂载两条匿名链（复制 site 链：RequestID→ClientIP→SecurityHeaders→Logging→Recover） | `go build ./... && go vet ./...`                                                                |
| 2.3    | handler 测试 ×2（200 + 包络 + message 字段）；swagger 注册按现有 `RegisterSwagger` 机制扩展（若仅支持单 spec 则不动，记入后续）                                                                                     | `go test ./...`                                                                                 |

### 阶段 3：四端脚手架（并行度 4，依赖阶段 1；与阶段 2 并行）

> 四端文件所有权互不相交。**共同禁止事项**：不执行 `pnpm install`（lockfile 由阶段 4 收口独占）；flutter 工程内禁止出现 `package.json`；每端 hello world 页面必须真实调用 ping 并渲染返回值（不可写死字符串）。
> 每端公共件：`orval.config.ts`（输入指向各自契约入口）、`scripts/generate-controllers.mjs`（照抄 admin 现有脚本）、`src/api/client.ts`（axios mutator：包络解包 + 错误提示，匿名端无 token 逻辑）、vitest 冒烟测试 ×1。

| 任务卡      | 内容                                                                                                                                                                    | 验收（本地可验部分）                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 3.1 h5      | Modern.js SSR 工程（版本对齐 site `^3.5.0`），`modern.config.ts` proxy + 端口 18082，ping 页经 orval 生成物调用                                                         | `pnpm --filter @monorepo-template/h5 build`                                   |
| 3.2 desktop | electron-vite + React 工程，渲染层 dev proxy + 端口 18083，ping 页经 orval 生成物调用                                                                                   | `pnpm --filter @monorepo-template/desktop build`                              |
| 3.3 miniapp | Taro4 + React 工程（weapp），**axios 桥接：mutator 内用 `axios-miniprogram-adapter`（或直接桥接 `Taro.request`）**，ping 页经 orval 生成物调用                          | `pnpm --filter @monorepo-template/miniapp build`（`taro build --type weapp`） |
| 3.4 mobile  | `flutter create --platforms=android,ios`，Material hello world + `http` 包手写调用 `/api/app/ping` 并渲染（dart 生成链列入后续）；README 注明 Android 模拟器 `10.0.2.2` | `flutter analyze && flutter test`                                             |

### 阶段 4：收口与联通验证（并行度 1，依赖阶段 2+3）

| 任务卡 | 内容                                                                                                                                                     | 验收                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 4.1    | 独占执行 `pnpm install`（lockfile 单点）→ `pnpm gen:api` 全量 → `pnpm verify` 全绿                                                                       | verify 通过                  |
| 4.2    | 端到端联通验证：起 server（18085）+ h5 dev（18082），curl 两个 ping 端点，h5 页面渲染返回值；desktop/miniapp/mobile 按各自 README 步骤人工或脚本验证一次 | 四端均渲染 `pong from * api` |

### 阶段 5：CI / verify 门禁集成（并行度 1，依赖阶段 4；与阶段 6 并行）

| 任务卡 | 内容                                                                                                                                                                                   | 验收                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 5.1    | `.github/workflows/ci.yml`：新增 flutter job（`subosito/flutter-action@v2` stable + 缓存，`pub get / analyze / test`，`paths: apps/mobile/**` 过滤）；JS 三端确认被现有 turbo 任务覆盖 | CI 绿                                      |
| 5.2    | 契约-生成物漂移门禁：CI 增加 `pnpm gen:api && git diff --exit-code`                                                                                                                    | 人为改契约不改生成物时 CI 红（自验后回滚） |
| 5.3    | `scripts/verify.sh`：flutter 条件化（`command -v flutter` 存在才跑 analyze/test，否则打印跳过提示）                                                                                    | 有无 flutter 两种环境下 verify 均通过      |

### 阶段 6：文档收口（并行度 1~2，依赖阶段 4；与阶段 5 并行，文件不相交）

| 任务卡 | 内容                                                                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1    | `AGENTS.md`：新增 mobile/desktop/miniapp/h5 分区规则（目录约定、依赖白名单、orval+Controller 范式、匿名链边界）、契约清单从 2 份改 4 份；`docs/multi-audience-contracts.md`：登记 app/h5 两受众（前缀、匿名边界、预留认证槽位、只加不改规则适用） |
| 6.2    | `README.md` 与四端各自 README：工程简介、dev/build/test 命令、平台注意事项（微信开发者工具域名校验、Android 模拟器地址、flutter SDK 要求）                                                                                                        |

### 排期与并行图

```
阶段1 (契约, 1人)
  └─► 阶段2 (server, 1人) ─┐
  └─► 阶段3 (h5/desktop/miniapp/mobile, 4人并行) ─┤
                                                 ▼
                              阶段4 (收口, 1人, lockfile 独占)
                                                 ├─► 阶段5 (CI, 1人)
                                                 └─► 阶段6 (文档, 1人)
```

- 阶段 2 与阶段 3 可同波启动（都只依赖阶段 1），但受全局并行 4 上限约束，planner 排队调度（建议 server + 3 端先行，mobile 递补——flutter 不碰 lockfile，最不怕排队）。
- 估算：阶段 1 ≈ 0.5 人日；阶段 2 ≈ 1 人日；阶段 3 每端 0.5~~1 人日（miniapp 因 axios 桥接取上限）；阶段 4 ≈ 0.5；阶段 5 ≈ 0.5；阶段 6 ≈ 0.5。合计 **5~~6 人日，并行后约 1.5~2 日历天**。

---

## 6. 风险清单

| 风险                                                                            | 等级 | 缓解                                                                                                               |
| ------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------ |
| Taro 小程序内 axios 不能用（无 XHR，只有 `wx.request`）                         | 中   | 任务卡 3.3 已内建桥接方案（`axios-miniprogram-adapter` 或 mutator 直桥 `Taro.request`）；验收以真机/模拟器联通为准 |
| 跨文件 `$ref` 在两个生成器间行为不一致                                          | 中   | 任务卡 2.1 内建验证步骤；失败预案：gen 链加 redocly bundle（以 bundle 产物为输入）                                 |
| 多 agent 并行写 `pnpm-lock.yaml` 冲突                                           | 高   | 阶段 3 禁止 install；阶段 4 收口独占 lockfile                                                                      |
| flutter 进 CI 拉长时长 / 本地无 SDK                                             | 低   | flutter-action 开缓存 + paths 过滤；verify.sh 条件化跳过                                                           |
| 新版本脚手架与仓库工具链不兼容（Taro4 / electron-vite / vitest5 / Node ≥20.19） | 低   | 阶段 4 verify 门禁兜底；版本号在任务卡中钉死                                                                       |
| 匿名新端点被网关误放行暴露面扩大                                                | 低   | ping 只读无数据；部署侧网关放行清单新增 `/api/app`、`/api/h5` 时按公开受众同规则评审                               |
| `apps/mobile` 被 pnpm workspace 误吞                                            | 低   | 任务卡禁止事项：flutter 工程内不得出现 `package.json`                                                              |

---

## 7. 后续阶段（明确不在本次）

1. **C 端用户体系**：新用户域（与 admin 用户隔离）、分平台登录（小程序 code2session / 手机号 OTP / 微信授权）、user JWT 中间件插入预留槽位；
2. **`admin.yaml` 多文件迁移**：触发条件 = 任一契约超 800 行或新增业务域；
3. **flutter 侧生成链**：dart openapi 生成器集成（占坑期为手写请求）；
4. **新端 e2e**：playwright h5 project、miniapp/desktop 冒烟自动化；
5. **main.go 装配 helper 抽取**（受众 >4 时）与 `generate-controllers.mjs` 抽公共包（5 份拷贝时）；
6. **目录重组**（services/api、contracts/、apps/web）：以已回滚的 `docs/restructure-plan.md` 为底稿另行评审。

---

## 8. 执行记录

| 阶段             | 状态      | 提交                                                                  | 备注                                                                                                                                                                               |
| ---------------- | --------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 方案评审       | ✅ 本文档 | `34f6aa8`                                                             | 2026-09-19，经 grill-me 逐题评审                                                                                                                                                   |
| 1 契约骨架       | ✅ 完成   | `1ee7de0`                                                             | redocly lint 0 错误；入口补 `servers: [{url: /}]` 消除 no-empty-servers                                                                                                            |
| 2 server 双受众  | ✅ 完成   | `93c4f1f`                                                             | 追加任务卡 2.4：oapi-codegen 不支持 schema 片段跨文件 `$ref`，按预案加 redocly bundle 步骤；重新生成产物与既有产物逐字节一致                                                       |
| 3 四端脚手架     | ✅ 完成   | `247d858`(h5) `e442863`(desktop) `35b4b5c`(miniapp) `bd4f750`(mobile) | miniapp 实测 axios-miniprogram-adapter 与 axios 1.x 不兼容，改为 mutator 直桥 Taro.request；本机无 Flutter SDK，mobile 为手写最小包，平台目录留待 `flutter create .`               |
| 4 收口与联通验证 | ✅ 完成   | `2767931`                                                             | install +1873 包；gen:api 6/6；lint/typecheck/test/build 全绿；verify 连续两次 exit 0；curl 双 ping 与 h5 SSR 均返回 pong；desktop/miniapp/mobile 运行时联通留人工                 |
| 5 CI 门禁        | ✅ 完成   | `b898031`                                                             | flutter.yml（paths 过滤 + flutter-action）；ci.yml 加漂移检查 `pnpm gen:api && pnpm format:write && git diff --exit-code`；verify.sh flutter 条件化（本机无 SDK 走跳过分支，全绿） |
| 6 文档收口       | ✅ 完成   | `15b0370`                                                             | AGENTS.md 追加规则 22-25；multi-audience-contracts.md 登记 app/h5；根 README 与三端 README 补齐                                                                                    |
