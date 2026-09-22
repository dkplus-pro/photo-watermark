# Server 开发规范

技术栈:Go(标准库 `net/http` 即可,按需再引中间件库)。

## 目录结构

```text
apps/server/
  cmd/server/
    main.go              入口:只做装配(run() 返回 error,os.Exit 只在 main 一层),不放业务
    bootstrap.go         启动期副任务:权限注册表同步对账(bootstrapPermissions)
  internal/
    handler/             HTTP 层:按受众分子包(admin/site/app/h5),实现 oapi-codegen 生成的 ServerInterface
    service/             业务逻辑层:核心规则都写在这里
    media/  uploads/     文件域业务:媒体资源 / 大文件分片上传
    repo/                数据访问层:只管存取,不含业务判断
    httpapi/             传输层公共件:中间件链、{code, message, data} 信封、路由权限注册表
    oplog/               业务操作日志埋点(service 显式调用)
    storage/             文件存储多厂商抽象(local / COS)
    auth/  reqctx/  uid/ 叶子包:JWT 签名校验 / 请求上下文身份与 IP / UUID
    archguard/           架构守护测试(依赖方向矩阵 + 权限对账)
    config/              配置加载(env / 文件)
    types/               内部领域模型
  gen/                   oapi-codegen 生成物(admin/site/app/h5 四份,勿手改)
  oapi.*.cfg.yaml        oapi-codegen 配置(每受众一份)
  package.json           暴露 dev/build/gen:api 脚本,交给 turbo 编排
```

目录按层分区,禁止跨层乱引用:`handler → service → repo` 单向依赖,handler 不直接碰 repo,service 不感知 HTTP 细节。

数据库表结构、字段类型约定与 SQLite → MySQL 迁移方案见 [database.md](./database.md);repo 层通过 GORM 双驱动按配置切换。

## 文件存储(多厂商抽象)

文件介质统一经 `internal/storage.Storage` 接口存取,业务层(media 等)只面向接口,不感知厂商;方案全貌见 [mvp-plan.md](./mvp-plan.md) 阶段 6。

- **一个厂商一个文件**:`local.go`(本地目录)、`cos.go`(腾讯云 COS),后续 `tos.go`(火山引擎);各自封装 SDK 细节,对象 key 规则统一为 uuid + 扩展名(+ 可选厂商前缀);
- **接口要点**:`Save` 流式写入返回 key 与字节数;`Open` 返回 `io.ReadCloser`(本地返回 `*os.File`,内容端点断言回 `io.ReadSeeker` 保留 Range);`URL(key)` 返回外网地址(CDN 直链,本地为空串);`Driver()` 返回驱动名写入 `files.storage`;`Delete` 幂等;
- **配置走环境变量**:`internal/config` 启动时经 godotenv 加载 `.env.local`、`.env`(进程环境变量优先);`STORAGE_DRIVER` / `STORAGE_BASE_PATH` / `COS_*` 键清单见 [mvp-plan.md](./mvp-plan.md) 阶段 6;`main.go` 按 `STORAGE_DRIVER` switch 装配,切换驱动 = 改环境变量 + 重启;
- **新增厂商**:实现接口 → `internal/config` 增 `{VENDOR}_*` 变量与校验 → main 装配分支 → `files.storage` 取值登记,业务代码零改动;
- **密钥纪律**:厂商密钥只留本地 `.env.local`(`.env.*` 已 gitignore),仓库只提交 `.env.example` 占位;密钥不入库、不进 CI,生产环境由部署平台注入同名环境变量。

## 接入 monorepo

Go 不归 pnpm 管,但为了根目录一条命令跑起整个项目,server 通过 `package.json` 暴露统一脚本:

```json
{
  "name": "@monorepo-template/server",
  "private": true,
  "scripts": {
    "dev": "go run ./cmd/server",
    "build": "go build -o bin/server ./cmd/server",
    "gen:api": "按 admin → site → app → h5 依次生成(多文件契约先 redocly bundle,完整命令见 apps/server/package.json)"
  }
}
```

这样根目录 `pnpm dev`(turbo `--parallel`)即可同时拉起 admin 与 server。

## OpenAPI 接口生成

- 契约按受众存在 `openapi/` 目录,共 4 份:admin/site 为单文件(`openapi/admin.yaml`、`openapi/site.yaml`),app/h5 为多文件目录(`openapi/app/`、`openapi/h5/`,生成前先 `redocly bundle`);受众边界见 [multi-audience-contracts.md](./multi-audience-contracts.md);
- `pnpm gen:api`(即 `oapi-codegen`)生成 `gen/<受众>/` 下的 types、请求/响应骨架与 `ServerInterface`;
- handler 按受众分子包(`internal/handler/<受众>/`),包内按接口拆文件实现 `ServerInterface`(一个资源一个文件);
- 本地调试用 Swagger UI:`httpapi.RegisterSwagger` 在 root mux 挂 UI 与 4 份契约(admin/site/app/h5,spec 路径由 `cfg.Swagger` 配置),列表与下载不经过受众中间件链;
- 生成物不手改;契约变更流程:改对应受众契约 → 重新生成 → 补 handler 实现。

## 分层与错误处理

- **handler 薄**:参数绑定、鉴权、调 service、按状态码写响应,不写业务规则;
- **service 厚**:业务规则、事务边界都在 service;入参出参用内部领域模型,不直接暴露生成物类型穿透各层;
- **repo 只管存取**:屏蔽具体存储(SQL / 内存),供 service 调用;
- 错误:包内定义哨兵错误(`errors.Is` / `errors.As`),跨层传递用 `fmt.Errorf("...: %w", err)`,在 handler 统一映射为 HTTP 状态码;repo 哨兵不出业务包,由 `service`/`media`/`uploads` 转译为本包哨兵后再向上返回,handler 只判业务哨兵;
- 架构约束由守护测试 `internal/archguard` 把关:`go list` 断言 internal 依赖方向矩阵,权限对账测试断言 admin 契约 ↔ `httpapi.RoutePermissions` 双向一致(漏注册与幽灵条目都红灯),豁免清单已清零、不得新增。

## 简洁性规则

- `main.go` 只做装配:`run()` 返回 error(`os.Exit` 只在 main 一层,defer 保证生效),受众路由走表驱动注册 + 公开基链 `baseChain` 复用,权限注册表同步对账抽 `bootstrapPermissions`(见 `cmd/server/bootstrap.go`);启动逻辑超过约 **300 行**拆 bootstrap 独立文件;
- 任何单文件超过约 **400 行**,按资源或职责拆分;
- 新增接口的固定动作:改对应受众契约(admin 为 `openapi/admin.yaml`)→ `gen:api` → 建 handler 文件 → 写 service 方法 →(需要时)扩 repo。

## CSRF 与会话安全

(安全基线方案见 [admin-enhancement-plan.md](./admin-enhancement-plan.md) 阶段 10。)

**结构性前提**:当前认证是 **JWT Bearer + localStorage + `Authorization` 请求头**——跨站页面/表单无法附加自定义请求头,服务端也不读 Cookie,经典 CSRF(依赖浏览器自动携带 Cookie)在结构上不成立。

**硬约束**:**禁止把会话迁往 Cookie**。若未来确需迁移,必须在同一变更中同步落地 `SameSite=Lax/Strict` + CSRF token(双提交或同步器模式),否则不得合并——Cookie 会被浏览器跨站自动携带,没有配套防御的迁移等于直接引入 CSRF 漏洞。

在此基础上,server 已落地的纵深防御(`internal/httpapi`,中间件链见 `cmd/server/main.go`):

- `OriginCheck(allowedOrigins)`:只挂 **admin 链**(site 链公开只读不挂),位置在 `RequestID` 之后、`JWTAuth` 之前。非安全方法(GET/HEAD/OPTIONS 之外)且请求带 `Origin` 头时,Origin 必须精确命中白名单,否则 403;不带 `Origin` 的非浏览器调用(curl、服务间)放行。白名单来自环境变量 `CSRF_ALLOWED_ORIGINS`(逗号分隔,精确匹配 scheme+host+port),默认 `http://localhost:8081`(dev 代理下 admin 的 Origin,开箱即用);生产部署必须注入真实后台域名。
- `SecurityHeaders()`:各受众链(baseChain)都挂,统一输出 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、`Cache-Control: no-store`。CSP 暂不施加(策略源在 admin 托管层,构建期以 meta 兜底);Swagger 页面注册在 root mux、不经过链,无需处理。
