# apps/server/AGENTS.md

本文件面向 AI 编码助手,是 `apps/server`(Go API 服务,admin/site/app/h5 四受众)的架构约束规范。
根 [AGENTS.md](../../AGENTS.md) 的 server 规则(11-14)在此细化;人读全貌见 [docs/server.md](../../docs/server.md),架构方案与现状依据见 [docs/server-architecture-plan.md](../../docs/server-architecture-plan.md)。
本文件与根规则冲突时以本文件为准;违反本文件多数条目会被 `internal/archguard/` 守护测试直接红灯。

## 1. 分层与依赖方向矩阵

依赖方向矩阵(`internal` 内,**只允许**沿"允许依赖"列,禁止列一律不得 import;`gen/*` 生成物同样适用):

| 包                                   | 允许依赖（internal 内）                      | 禁止                                  |
| ------------------------------------ | -------------------------------------------- | ------------------------------------- |
| handler（各受众）                    | httpapi、service、media、uploads、types      | **repo**、config、其他受众 handler    |
| service                              | repo、types、auth、oplog、reqctx             | handler、httpapi、media、uploads      |
| media                                | repo、storage、oplog、reqctx                 | service、handler、httpapi             |
| uploads                              | media、storage、uid                          | repo（会话不建表，现状保持）、handler |
| repo                                 | （无 internal 依赖，自带 Config）            | service、handler、httpapi、config     |
| httpapi                              | auth、reqctx                                 | config、handler、service、repo        |
| oplog                                | repo、reqctx                                 | httpapi                               |
| storage                              | uid（对象命名）                              | 除 uid 外的 internal 包               |
| reqctx / uid / types / auth / config | （叶子包，无 internal 依赖）                 | 任何 internal 包                      |
| archguard                            | （守护测试包，仅测试文件，零 internal 依赖） | 任何 internal 包                      |
| gen/\*                               | （无 internal 依赖，各受众 handler 引用）    | 禁止手改（CI 漂移门禁已有）           |

**业务层定义**:业务层 = `service`(后台管理域)+ `media` + `uploads`(文件域)三个领域服务包;handler 只允许依赖业务层,不得 import `repo`。

- 新增 import 前先核对本表;矩阵之外的内部依赖不得引入,需要新依赖先改矩阵(并在本文件登记)再写代码;
- 叶子包(`reqctx`/`uid`/`types`/`auth`/`config`)保持零 internal 依赖,新公共工具优先放叶子包或既有包,不新开"万能 util";
- 矩阵由守护测试 `internal/archguard/` 以 `go list -json ./internal/...` 断言,违反即 CI 红灯,不得新增豁免。

## 2. 新受众接入步骤

新增一个受众(如新增 `web` 受众)按固定顺序落地,不得跳步、不得手写与契约重复的类型:

1. **契约**:在 `openapi/` 下落契约——单文件 `openapi/<受众>.yaml`,或多文件目录 `openapi/<受众>/`(多文件需 `redocly bundle` 后再生成);路径字面带 `/api/<受众>` 前缀,公开受众只读且不声明 `securitySchemes`;
2. **oapi cfg**:在 `apps/server/` 增 `oapi.<受众>.cfg.yaml`(`package`/`output: gen/<受众>/gen.go`/`generate: models + std-http-server`),照抄现有 4 份配置;
3. **gen**:把生成命令追加进 `apps/server/package.json` 的 `gen:api` 脚本(多文件先 bundle 到 `.gen-bundle/`),再执行 `pnpm gen:api`;`gen/<受众>/` 为生成物,禁止手改;
4. **handler 子包**:新建 `internal/handler/<受众>/`,实现该受众 `ServerInterface`,并写编译期断言 `var _ <受众>gen.ServerInterface = (*XxxHandler)(nil)`;一个资源一个文件,包注释声明鉴权边界(公开/需登录);
5. **main 受众表**:在 `cmd/server/main.go` 的受众表登记一条(前缀 → handler → 中间件链),由表驱动注册,不复制中间件链代码;
6. **网关前缀**:公开受众登记网关放行前缀(`/api/<受众>/*`,admin 路径保持仅内网/VPN 可达),并同步 [docs/multi-audience-contracts.md](../../docs/multi-audience-contracts.md) 的受众表。

- 公开受众链一律复用 `baseChain`(RequestID → ClientIP → SecurityHeaders → Logging),`Recover` 恒为最后一环追加;admin 链在其之上额外挂 `OriginCheck`、`JWTAuth`、`PermissionCheck`;
- 公开受众无鉴权、无权限码、无 token 注入;权限码只属于 admin 契约与 `httpapi.RoutePermissions`。

## 3. 错误处理

- 每个包定义**本包哨兵错误**(`errors.New`),跨层传递用 `fmt.Errorf("...: %w", err)`,不裸传错误文本;
- **哨兵转译边界**:repo 哨兵不得出 repo 所属业务包——`service`/`media`/`uploads` 必须把 repo 哨兵转译为本包哨兵(如 `service.ErrUserNotFound`),再向上返回;
- **哨兵清单**(与实现对齐,新增哨兵同步本条):`service` = not-found 四件套 `ErrUserNotFound`/`ErrRoleNotFound`/`ErrDictNotFound`/`ErrDictEntryNotFound`(`errors.go`,由 repo 哨兵转译而来)+ 业务哨兵 `ErrUsernameExists`、`ErrSelfOperation`、`ErrBuiltinUser`、`ErrRoleCodeExists`、`ErrBuiltinRole`、`ErrRoleInUse`、`ErrPermissionInvalid`、`ErrDictCodeExists`、`ErrDictValueExists`、`ErrInvalidConfigGroup` 与登录哨兵 `ErrInvalidCredentials`、`ErrUserDisabled`、`ErrWrongOldPassword`;`media` = 转译对 `ErrMediaNotFound`/`ErrMediaGroupNotFound` + `ErrInvalidType`、`ErrTooLarge`、`ErrGroupNameExists`、`ErrInvalidGroup`、`ErrInvalidGroupName`;`uploads` = `ErrSessionNotFound`、`ErrInvalidSize`、`ErrInvalidIndex`、`ErrChunkTooLarge`、`ErrIncomplete`(会话落盘不建表,无 repo 哨兵);
- handler 只判业务层哨兵(`service`/`media`/`uploads`)与 `gen` 类型,不得 import `repo` 或用字符串匹配错误;
- HTTP 响应**只走** `httpapi.WriteJSON` / `httpapi.WriteError`(统一 `{code, message, data}` 信封),禁止 handler 内直接 `json.NewEncoder`、`w.Write`、`http.Error`;
- 状态码映射在 handler(400 参数/401 未登录/403 无权限/404 不存在/409 冲突/500 内部错误),内部错误细节只进日志、不透给客户端。

## 4. 事务规则

- **多步写必须在单个 repo 事务内聚合**:校验与写入不得分离成两次调用(现状 `UpdatePermissions` 的 TOCTOU 即反例),repo 提供原子方法,service 一次调用完成;
- 事务边界在 repo(`Begin/Commit/Rollback` 只出现在 `internal/repo/`);service 不感知事务对象;
- **禁止 service 层直接拼 GORM**:不得在 service 里用 `*gorm.DB` 做查询/链式 `Where`/事务;需要新查询就在 repo 加方法;
- 单事务覆盖不了的多资源写(如"存文件 + 落库")走**显式 saga**:每步的补偿动作(删除已写入的文件/会话等)必须写在代码注释里声明,并配失败路径测试;
- 新增/改动写路径必须覆盖非法状态迁移与中途失败(补偿语义)两类边界。

## 5. oplog 规则

- **写操作成功与失败都埋点**:`oplog.Success` / `oplog.Failed`(或 `oplog.Record` + 状态),增删改、状态切换、登录、上传/删除媒体等一律成对出现;
- `action` 形如 `资源.动作`(`user.delete`、`dict.update`),`description` 写人话并带对象标识;失败埋点也要写清失败原因;
- **查询接口不埋点**:GET 不记业务日志;查询接口只读业务日志(访问日志另走 slog + `logs/` 文件,双轨见根规则 11a);
- **埋点不参与业务 tx**:oplog 独立写库,业务回滚不清除已记日志,也不得把 oplog 写放进业务事务里;
- 新增写接口时同步检查失败分支,不留"只有成功埋点"的缺口。

## 6. 权限规则

- **新增/改动 admin 端点必须同步 `httpapi.RoutePermissions` 条目**(`Method`/`Pattern`/`Code`/`Name`/`Menu`/`MenuName`),权限码命名 `模块:资源:动作`(如 `system:user:list`);漏一条 = 该端点静默降级为"登录即可访问",守护测试会以契约 ↔ 注册表双向对账拦截(漏注册与幽灵条目都红灯);
- **公开端点清单显式列举**(免鉴权,`httpapi.JWTSkipPaths` 白名单,仅此两处):`GET /api/admin/healthz`、`POST /api/admin/auth/login`;其余 `/api/admin/*` 全部要求 JWT,命中注册表的再校验权限码;
- 注册表移除条目的对账清理由启动时 `UpsertApiPermissions` + `PrunePermissions` 自愈,不得手工改库;
- site/app/h5 公开受众无权限概念,公开边界靠"只读 + 网关放行前缀",不得借公开受众绕过 admin 权限;
- 不得给权限对账守护测试加豁免或跳过用例。

## 7. 测试纪律

- **六类边界必查**:空值、零值、越界、权限缺失、网络失败、非法状态迁移;做计划时先写用例、定义边界,用例与实现同批交付;
- **新增端点必须带 handler 测试**(参数绑定、状态码映射、权限缺失/未登录路径),与实现同批提交;存量 handler 零覆盖按资源滚动补齐;
- 测试用 sqlite `:memory:` 真库,不引入 mock 框架、不 mock repo;
- **守护测试(`internal/archguard/`)不得加豁免**:import 矩阵与权限对账必须全绿,存量越层豁免清单在阶段 2 收口时清零,清零后不再新增;
- 改动后本地门禁:`go build ./... && go vet ./... && go test ./...`;涉及前端/契约的改动跑根 `pnpm verify`。

## 8. 文件纪律

- **单文件 ≤400 行**,超出按资源或职责拆分;
- **一资源一文件**:handler 一个资源一个文件(`users.go`/`roles.go`/...),跨资源复用的 helper 放 `helpers.go`,禁止把 helper 堆在业务文件里被其他文件引用;
- **生成物禁改**:`gen/**`、`apps/server/.gen-bundle/**`;契约变更流程固定为 改 `openapi/` → `pnpm gen:api` → 补实现,不手改生成类型、不手写重复接口类型;
- **`main.go` 只做装配**:读配置 → 连库 → 建服务 → 挂中间件链 → 监听;受众注册走受众表 + `publicChain`,权限对账抽独立函数;启动逻辑超 300 行拆 `bootstrap`(独立文件/函数);
- 命名按资源/领域语义化,禁止 stage/temp/new/copy 等过程性命名;代码风格交给 gofmt,不自创风格。
