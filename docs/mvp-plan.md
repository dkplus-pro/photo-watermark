# 管理后台 MVP 分阶段交付计划

本计划回答"做什么、按什么顺序";"怎么写代码"遵循 [development.md](./development.md)、[admin.md](./admin.md)、[server.md](./server.md)。接口与页面的全量核对清单见 [api-pages.md](./api-pages.md),本文各阶段表格仅作范围摘要。

## 目标与边界

MVP 目标:交付一个可登录、按角色控权、可管理用户/角色/菜单、可查操作日志、可改系统配置的管理后台;全程 OpenAPI 契约驱动(Go 服务端 + `pnpm gen:api` 生成前端 API/Types + Swagger UI 展示)。

明确不做(非目标):数据权限、SSO/OAuth/多因素登录、多租户、审批流、消息通知、审计报表、国际化。

## 总体技术决策

| 项         | 决策                                              | 说明                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 接口契约   | `openapi/` 目录单一事实源,按受众分文件            | admin 用 `openapi/admin.yaml`(tags: auth/users/roles/permissions/logs/configs/dicts/files);对外站点契约 `site.yaml` 见 [multi-audience-contracts.md](./multi-audience-contracts.md);server 用 oapi-codegen,前端用 orval 生成类型 + 接口函数(见 admin.md) |
| Swagger UI | server 暴露 `GET /swagger`                        | 直接托管契约目录;dev 必开,生产由配置开关                                                                                                                                                                                                                 |
| 存储       | GORM:dev SQLite / prod MySQL                      | 双端同一套模型建表;表结构与迁移方案见 [database.md](./database.md)                                                                                                                                                                                       |
| 认证       | JWT(HS256,Bearer)                                 | 有效期 2h,MVP 不做 refresh token 与服务端登出失效;密码 bcrypt                                                                                                                                                                                            |
| 权限模型   | RBAC:user → role → permission                     | permission 分 `menu`(菜单/页面/按钮可见)与 `api`(接口/操作)两类,统一存一张表;数据权限不做                                                                                                                                                                |
| 前端权限   | 静态菜单 + 权限码过滤(阶段 3 修订)                | 菜单与路由由前端代码静态声明(路径/组件/权限码),登录后按 `/auth/me` 下发的权限码过滤显隐;**服务端中间件独立校验,前端显隐只是体验,不是安全边界**                                                                                                           |
| 响应约定   | `{code, message, data}`                           | 分页入参 `page`/`pageSize`,返回 `{list, total}`;错误用 HTTP 状态码 + message                                                                                                                                                                             |
| 联调       | admin 开发态代理 `/api` → `http://localhost:8080` | 免 CORS;端口约定 server=8080、admin=8081                                                                                                                                                                                                                 |
| 前端数据层 | TanStack Query + orval axios 直调                 | 服务端状态用 `useQuery`/`useMutation` + `XxxController.xxx()`(见 admin.md);客户端全局状态用 zustand(`src/store/`)                                                                                                                                        |
| 工具库     | lodash + ahooks                                   | 通用 React 逻辑优先 ahooks,纯数据操作优先 lodash;请求不用 ahooks useRequest                                                                                                                                                                              |
| 文件存储   | storage 接口 + 多厂商实现(local / COS)            | 厂商由 storage 配置组 driver 选择;COS 直传对象存储、记录 CDN 地址;TOS 等厂商按同一接口扩展(见阶段 6)                                                                                                                                                     |

## 数据模型(一览)

完整字段、索引与类型约定见 [database.md](./database.md)。

| 表                 | 关键字段                                                                                 | 说明                                         |
| ------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| users              | id, username, password_hash, nickname, email, status                                     | status: 1 启用 / 0 禁用                      |
| roles              | id, code, name, remark, status                                                           | 内置超级管理员角色不可删                     |
| user_roles         | user_id, role_id                                                                         | 用户 ↔ 角色                                  |
| permissions        | id, code, type(menu/api), name, parent_id                                                | 统一权限点;code 见命名规范                   |
| role_permissions   | role_id, permission_id                                                                   | 角色 ↔ 权限,唯一关联表                       |
| operation_logs     | id, user_id, username, method, path, action, ok, status_code, ip, latency_ms, created_at | 只增不改                                     |
| files              | id, name, orig_name, mime, size, storage, url, path, uploader_id                         | storage: local / cos;url 存 CDN 直链(阶段 6) |
| sys_configs        | group, key, value                                                                        | KV,value 存 JSON;group: system / storage     |
| dicts / dict_items | code / dict_id, label, value, sort, status                                               | 字典与字典项                                 |

## 阶段总览

| 阶段 | 主题                                              | 规模 | 前置 | 可并行            |
| ---- | ------------------------------------------------- | ---- | ---- | ----------------- |
| 0    | 工程基座(契约流水线 + Swagger UI + 双端骨架)      | S    | —    | —                 |
| 1    | 登录与账号                                        | S    | 0    | —                 |
| 2    | 用户 · 角色 · 权限(RBAC 核心,API 权限生效)        | L    | 1    | —                 |
| 3    | 权限驱动的菜单(静态菜单方案,修订)                 | S    | 2    | 与阶段 4 前半并行 |
| 4    | 操作日志 · 系统基础配置                           | M    | 2    | 与阶段 3 并行     |
| 5    | 文件管理(整体可后置)                              | M    | 4    | 独立              |
| 6    | 对象存储接入(多厂商抽象,先接 COS)                 | S    | 5    | 独立              |
| 7    | 多受众契约拆分(admin / site)                      | S    | —    | 见专项文档        |
| 8    | URL 布局(网页 /admin、API /api/admin + /api/site) | S    | 7    | —                 |

规模:S ≈ 1-2 天,M ≈ 3-4 天,L ≈ 5-7 天(单人有效开发时间,仅用于排期参考)。

> MVP 阶段(0-8)已全部交付。MVP 之后的后台增强需求(菜单折叠修复、ErrorBoundary、logID 链路、XSS/CSRF 防御、UI 规范改版、Dashboard、媒体分组、分片上传)以阶段 9-14 继续分阶段推进,方案与验收见 [admin-enhancement-plan.md](./admin-enhancement-plan.md);后续批次(全仓测试体系、Admin UI 打磨、Site SSR 基座)为阶段 15-19,见 [quality-and-site-plan.md](./quality-and-site-plan.md)。

## 阶段 0:工程基座

目标:打通"改契约 → 双端生成 → 联调可见"的流水线,双端跑起空壳。

契约:仅 `GET /healthz` + 公共 schemas(Error、分页入参/出参、 bearerAuth 安全定义)。

server:

- 初始化目录(cmd/internal/gen),实现 `ServerInterface` 空壳 + healthz;
- oapi-codegen 配置与 `gen:api` 脚本接入 turbo;
- 中间件骨架:日志、Recover、统一错误响应;`/swagger` 托管 Swagger UI;
- SQLite + GORM 接入;建表用 GORM AutoMigrate,表结构与 MySQL 迁移方案见 [database.md](./database.md)。

admin:

- Modern.js 接入 Arco Design,全局布局壳(侧边栏 + 顶栏 + 面包屑)与欢迎页;
- `src/api` 生成流水线跑通;请求客户端封装(token 注入、401 跳登录、统一 Message);
- dev 代理 `/api` → 8080。

验收:`pnpm dev` 一键起双端;`/swagger` 可浏览契约;`pnpm gen:api` 双端生成物更新;`pnpm verify` 通过。

## 阶段 1:登录与账号

| 方法 | 路径           | 说明                                     |
| ---- | -------------- | ---------------------------------------- |
| POST | /auth/login    | 登录,返回 token、有效期、用户信息        |
| POST | /auth/logout   | 退出(MVP 前端清 token)                   |
| GET  | /auth/me       | 当前用户 + 角色 + 权限码(为动态菜单预留) |
| PUT  | /auth/password | 校验旧密码后修改                         |

server:users 表与种子管理员(**初始账号 `admin` / `admin123`,首次登录后应在"修改密码"中更换**);JWT 签发/校验中间件(除 /auth/login、/healthz、/swagger 外全量拦截);**操作日志中间件在本阶段埋点**(只记录不查询)。种子逻辑在 `internal/repo/seed.go`,users 表为空时创建,可重复执行。

admin:orval 接口生成(见 [admin.md](./admin.md));登录页(`routes/login/`);token 与当前用户进 zustand(`store/auth.ts`);路由守卫(全局 layout 内,未登录跳登录);顶栏用户下拉(修改密码弹窗、退出)。

验收:登录后进入壳;错误口令/禁用账号被拒;token 过期后任意请求跳登录;改密后旧 token 场景按新口令可登录。**本阶段已交付并验收**(e2e 覆盖完整登录-登出流程)。

## 阶段 2:用户 · 角色 · 权限(RBAC 核心)

| 方法               | 路径                    | 说明                                   |
| ------------------ | ----------------------- | -------------------------------------- |
| GET / POST         | /users                  | 列表(分页 + keyword/status 筛选)/ 新建 |
| GET / PUT / DELETE | /users/{id}             | 详情(含角色)/ 编辑 / 删除              |
| PATCH              | /users/{id}/status      | 启用 / 禁用(不可操作自己)              |
| PUT                | /users/{id}/roles       | 分配角色                               |
| GET / POST         | /roles                  | 角色列表 / 新建                        |
| GET / PUT / DELETE | /roles/{id}             | 角色 CRUD                              |
| PUT                | /roles/{id}/permissions | 角色分配权限(权限点 ID 全量覆盖)       |
| GET                | /permissions            | 全量权限点树(menu + api)               |

server:

- 权限相关五张表落地;**API 权限点以 server 路由注册表为源**(`internal/httpapi/permission.go`),启动时 upsert 进 permissions(type=api);菜单权限点随注册表自动创建;种子含内置超级管理员角色 super_admin(全权限,启动时授予全量权限点并绑定初始管理员);
- API 鉴权中间件:按"方法 + 路径 → 权限码"注册表校验,未命中权限码的接口仅要求登录;
- 防呆:不可删除/禁用自己与内置管理员;删除角色前校验仍有绑定则拒绝。

admin:用户列表页(搜索表格范式)+ 新建/编辑弹窗 + 状态 Switch + 分配角色弹窗(多选);角色列表页 + 权限分配弹窗(Tree 勾选,菜单权限与 API 权限分组展示)。

验收:无权限账号调用对应 API 返回 403;管理员可完成用户/角色/授权全流程;`/auth/me` 返回的权限码随授权变化。**本阶段已交付并验收**(service 单测覆盖守卫与授权链路,e2e 覆盖用户创建流程)。

## 阶段 3:权限驱动的菜单(静态菜单方案,修订版)

> **方案修订说明**:本阶段曾按"菜单管理界面 + 服务端下发菜单树驱动动态路由"交付。实际使用方为非技术人员,让其在界面配置路由路径、组件 key、权限码不可接受且易错;且菜单结构变更本就伴随发版。修订为:**菜单与路由由前端代码静态声明,运行期只按权限码过滤显隐**。管理员只需要在角色管理里勾选权限(勾"用户管理"= 看得到用户菜单 + 能调相关接口),不再存在"菜单管理"这一概念。

### 新方案

- **菜单声明**:`apps/admin/src/config/menu.ts` 静态声明菜单树:路径、名称、图标、所需权限码、子菜单;权限码与服务端路由注册表(`internal/httpapi/permission.go` 的 Menu 字段)同名,由开发保证一致;
- **路由**:回到 Modern.js 约定式静态路由(页面在 `routes/` 下按目录组织),`$.tsx` 仅作 404 兜底;新增页面 = routes 页面 + menu.ts 一行声明 + 契约接口,**不存在运行时组件分发**;
- **侧边栏**:layout 按 `/auth/me` 下发的权限码过滤静态菜单声明——菜单绑定了权限码则要求命中,目录只要有任一可见子项即显示;面包屑取当前菜单名;
- **权限点**:服务端路由注册表继续在启动时创建 `menu:` 权限点(用于角色授权树分组),与 menus 表无关;
- **服务端**:不下发任何菜单数据;`/auth/me` 的 `permissions` 字段(已实现)即菜单显隐的全部依据。

### 接口变化

移除 5 个接口:`GET/POST /menus`、`GET/PUT/DELETE /menus/{id}`、`GET /auth/menus`;契约同步删除 MenuItem / MenuUpsertRequest / AuthMenuNode schemas 与 menus tag。`system:menu:*` 四个 api 权限点随注册表条目一并移除。

### 从旧方案回退(代码层)

阶段 3 已按旧方案交付,修订采用**原地修改而非整体回滚**(保留旧提交中的 permissions.Tree 指针挂载 bugfix 与 404 组件)。回退清单:

- server:删 `internal/{repo,service,handler}/menu*.go`、menus 表模型与 AutoMigrate 条目、SeedMenus、注册表 4 条 system:menu:× 路由;`/auth/me` 与权限中间件不动;
- admin:页面组件从 `src/pages/` 移回 `routes/`(users/roles);删 `config/component-registry.tsx`、`hooks/use-auth-menus.ts`、`pages/system/menus.tsx`;`$.tsx` 恢复为纯 404;layout 侧边栏改为"静态菜单 × 权限码过滤";
- 契约:删 menus 块后 `pnpm gen:api`,前端 `MenusController`、`getAuthMenus` 自动消失;
- 测试:e2e 去掉菜单管理页步骤,保留"调整角色权限 → 菜单显隐变化"断言。

验收:角色未授权某菜单权限码时侧边栏不显示该菜单、直访路由得到 404/403;授权后重新登录可见;直接调用被限接口仍被服务端 403。

## 阶段 4:操作日志 · 系统基础配置(可与阶段 3 并行)

> **操作日志方案修订**:已交付版本把 HTTP 访问日志(方法/路径/状态码/耗时)入库展示,那是给开发 debug 用的,对运营没有意义。本系统使用方是非技术运营人员,修订为**双轨日志**:
>
> - **HTTP 访问日志(开发用)**:不再入库,`slog` 结构化输出到 stdout + 按天滚动的日志文件(`logs/server-YYYY-MM-DD.log`),启动时清理超过保留天数(`ACCESS_LOG_RETAIN_DAYS`,默认 7 天)的旧文件;无查询接口,排查问题时看服务器文件。
> - **业务操作日志(运营用)**:记录"谁在什么时间对什么对象做了什么、结果如何",入库长期保留(审计数据,MVP 不清理),日志页只展示这一种。

### 业务操作日志(修订后)

记录载荷(一条 = 一次业务动作):

```json
{
  "user_id": 1,
  "username": "admin",
  "action": "user.delete",
  "resource": "user",
  "resource_id": "123",
  "description": "删除用户 张三(zhangsan)",
  "status": "success",
  "ip": "192.168.1.10",
  "created_at": "2026-09-06T12:30:00Z"
}
```

- **埋点方式:service 层显式记录**,不再用 HTTP 中间件自动抓——中间件只有请求信息,拿不到"张三"这类业务上下文,而 `description` 是给运营看的人话,必须写进业务代码;封装 `oplog.Record(ctx, db, Entry{...})` 供各 service 调用(操作人 ID/用户名/IP 从 context 的 claims 传递);
- **记录范围:增删改 + 登录,查询一律不记**。覆盖:登录(含失败)、修改密码、用户增删改/启停/分配角色、角色增删改/分配权限、配置组更新、字典与字典项增删改;阶段 5 补文件上传/删除;
- **action 命名**:`资源.动作`(如 `user.delete`、`user.assignRoles`、`role.assignPermissions`、`config.update`、`dictEntry.create`),集中登记在一个映射里与 description 模板对应,避免散落字符串;
- **失败也记**:业务校验失败(409/403/400 哨兵错误)记 `status=failed`,description 含原因摘要(如"删除角色 ops 失败:仍有用户绑定");意外 500 不记业务日志(归访问日志);
- **resource_id 统一字符串**,兼容非数字资源(如配置组用 group 名);
- 登录失败(`user_id=0`,username 记尝试的登录名)保留记录,便于发现撞库尝试。

### 接口(修订后)

| 方法                      | 路径                                           | 说明                                                                       |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| GET                       | /operation-logs                                | 业务日志分页;筛选 操作人/资源/动作/成败/时间范围                           |
| GET / PUT                 | /configs/{group}                               | 读取/更新配置组(仅 system: 站名、Logo URL;storage 组已于阶段 6 迁环境变量) |
| GET / POST / PUT / DELETE | /dicts、/dicts/{code}/items、/dicts/items/{id} | 字典与字典项 CRUD                                                          |

契约变化:`OperationLogItem` 换为上述业务字段(去掉 method/path/statusCode/latencyMs),筛选参数换为 `username/resource/action/status + startTime/endTime`;权限码 `system:log:list` 不变。

server:业务日志表按新字段重建;各 service 在增删改方法落埋点;访问日志改文件输出 + 按天滚动清理;sys_configs、dicts/dict_items 不变;存储配置组由服务端启动时读取(local 目录),**管理端不展示**(运维项,修改需重启,见阶段 4)——阶段 6 起整体迁环境变量,不再是配置组。

admin:日志页改为业务语义——列:操作人/动作/资源/描述/结果/IP/时间,筛选同步替换;详情抽屉同步;系统设置页与字典管理页不变。

验收:创建/删除用户后,日志页出现"创建用户 Bob(bob)""删除用户 Bob(bob)"等人话条目;查询操作不产生日志;HTTP 访问日志只在文件里,按天滚动且过期清理。**本阶段已按修订方案交付并验收**(e2e 断言业务文案,单测覆盖埋点与筛选)。

### 从旧方案回退(代码层,**已执行**)

- server:删 `httpapi.OperationLog` 中间件与 main 装配(Logging 中间件保留并加文件输出/清理);`operation_logs` 模型改业务字段(action 唯一新索引:`resource + resource_id`);新增 `internal/oplog`(Entry + Record);逐个 service 方法补埋点;登录失败在 auth service 记录;
- 契约:schema 与筛选参数改后 `pnpm gen:api`;
- admin:日志页列/筛选/抽屉替换;e2e 断言改为业务文案(如删除用户后出现对应 description)。

## 阶段 5:媒体资源管理(方案修订;**已交付并验收**)——整体可后置项已完成

> **方案修订说明**:原方案是通用"文件管理"页。修订为**两层架构**——底层仍是通用文件存储(支撑未来任何业务的文件需求),上层按媒体类型规划资源接口与信息提取;admin 只做图片管理、视频管理两个页面,不做通用文件管理页(使用方是运营人员,"文件"对他们没有意义,图片和视频才有)。

### 分层设计

- **底层(通用,无 UI)**:`files` 表 + `internal/storage` 接口(local 实现,目录来自 storage 配置组;多厂商扩展见阶段 6),负责文件的存取与介质删除。通用 `/files` CRUD 接口**暂不对外暴露**——后续非媒体业务(如附件)需要时再开放,避免运营侧出现无语义的文件列表;
- **上层(类型化)**:`media_assets` 表(kind = image / video / audio,file_id 关联 files,meta 存提取的信息);每种类型注册一个**信息提取器**(`Extractor` 接口):图片用 Go 标准库解析宽高与格式,视频/音频 MVP 只记基础信息并预留 ffprobe 接入位(时长、分辨率、封面帧等后续按需补充);
- 上传流程:`storage.Save → files 记录 → 提取器解析 → media_assets 记录`;删除媒体级联删除底层文件与介质;
- 文件内容统一走 `GET /files/{id}/content`(登录即可,流式输出),图片预览与视频播放共用,上层接口不重复提供下载。

### 接口(本期交付图片 + 视频;音频规划预留)

| 方法         | 路径                | 说明                                       |
| ------------ | ------------------- | ------------------------------------------ |
| POST         | /images             | multipart 上传,校验类型/大小,提取宽高/格式 |
| GET          | /images             | 分页列表(含 meta)                          |
| GET / DELETE | /images/{id}        | 详情 / 删除(级联底层文件)                  |
| POST         | /videos             | 同构上传(meta 预留时长/分辨率)             |
| GET          | /videos             | 分页列表                                   |
| GET / DELETE | /videos/{id}        | 详情 / 删除                                |
| GET          | /files/{id}/content | 文件内容流(登录即可)                       |

- 音频 `/audios` 与图片/视频同构,**规划预留**,本期不落契约——开放时同步 `media:audio:*` 权限点;
- 后续按类型扩展提取信息即扩展对应 Extractor,不影响底层与表结构;
- 权限码:`media:image:list/upload/delete`、`media:video:list/upload/delete`(menu 点 `menu:media:image` / `menu:media:video`);音频预留 `media:audio:*`。

server:`files`、`media_assets` 表;`internal/storage` 接口 + local 实现;上传大小上限 MVP 用常量(图片 10MB、视频 200MB),后续迁入 storage 配置组;系统设置页 Logo 升级为从图片库选择。

admin:图片管理页(网格缩略图 + 上传弹窗 + 预览大图 + 删除确认)、视频管理页(列表 + 上传弹窗 + 内嵌 video 播放 + 删除确认);**不做通用文件管理页**。

验收:上传图片后缩略图与大图预览正常且 meta 含宽高/格式;上传视频可内嵌播放;删除媒体后 files 记录与介质文件同步删除;非图片/视频类型(如 .txt)被对应接口以 400 拒绝;音频接口未开放。**本阶段已按修订方案交付并验收**(e2e 覆盖真实上传与展示;冒烟覆盖提取/级联删除/类型拒绝)。

## 阶段 6:对象存储接入(多厂商抽象,先接 COS;**已交付并验收**)

> **方案说明**:文件介质要能从服务器本地目录迁到对象存储,且厂商不止一家(腾讯云 COS、火山引擎 TOS 等)。因此把"存文件"这一层按厂商抽象:接口唯一、厂商实现可插拔、配置按厂商分环境变量,新增厂商不改业务代码。本期先接 COS:**上传直传 COS,文件记录落 CDN 地址**,admin 展示走 CDN 直链。
>
> **配置纪律(用户明确要求)**:COS 密钥与连接参数只允许留在本地 `.env.local`(`.env.*` 已 gitignore,禁止提交),不入库、不进 CI;因此原"storage 配置组(数据库)"方案整体撤销,**存储配置全部走环境变量**,sys_configs 只剩 system 组。

### 多厂商抽象设计

- **接口唯一**:沿用 `internal/storage.Storage` 作为唯一存储抽象,media / 后续任何业务只面向接口编程,不感知厂商。接口随 OSS 需求修订:

  ```go
  type Storage interface {
      // Save 写入文件内容,返回对象 key(可选厂商前缀 + uuid + 扩展名)与字节数。
      Save(ctx context.Context, r io.Reader, ext string) (key string, size int64, err error)
      // Open 顺序读对象内容(本地内容端点用);本地实现返回 *os.File。
      Open(ctx context.Context, key string) (io.ReadCloser, error)
      // URL 返回外网可访问地址(CDN 直链);本地存储返回 ""。
      URL(key string) string
      // Driver 返回驱动名(local / cos / tos ...),写入 files.storage。
      Driver() string
      // Delete 删除对象;不存在视为已删除(幂等)。
      Delete(ctx context.Context, key string) error
  }
  ```

  `Open` 由 `*os.File` 放宽为 `io.ReadCloser`;本地实现仍返回 `*os.File`,内容端点类型断言回 `io.ReadSeeker` 以保留 Range 播放。

- **厂商实现可插拔**:一个厂商一个文件(`internal/storage/local.go`、`cos.go`,后续 `tos.go`),各自封装 SDK 与配置;`main.go` 按 `STORAGE_DRIVER` switch 装配,业务层零改动。
- **配置走环境变量**:`internal/config` 启动时经 godotenv 加载 `.env.local`、`.env`(已设置的进程环境变量优先,文件只补缺失项),运维项改后重启生效:

  | 环境变量            | 示例                      | 说明                                                                |
  | ------------------- | ------------------------- | ------------------------------------------------------------------- |
  | `STORAGE_DRIVER`    | `local` / `cos`           | 当前驱动,默认 `local`                                               |
  | `STORAGE_BASE_PATH` | `data/files`              | local 专用:存储目录                                                 |
  | `COS_SECRET_ID`     | `AKID...`                 | COS 专用:访问密钥 ID(建议子账号最小权限),driver=cos 必填            |
  | `COS_SECRET_KEY`    | `***`                     | COS 专用:访问密钥 Key,driver=cos 必填                               |
  | `COS_BUCKET`        | `my-assets-1250000000`    | COS 专用:Bucket 全名(含 APPID 后缀),driver=cos 必填                 |
  | `COS_REGION`        | `ap-guangzhou`            | COS 专用:地域,driver=cos 必填                                       |
  | `COS_CDN_DOMAIN`    | `https://cdn.example.com` | COS 专用:CDN 域名;为空时用默认 `{bucket}.cos.{region}.myqcloud.com` |
  | `COS_PREFIX`        | `tmp/`                    | COS 专用:对象 key 前缀,可空(自动归一化:去头部 `/`、补尾部 `/`)      |

  driver=cos 缺必填项时启动直接报错并列出全部缺失变量;`apps/server/.env.example` 提交占位模板,`.env.local` 持真实值且禁止提交。

- **新增厂商步骤**(拓展示例,文档化固定动作):
  1. `internal/storage/{vendor}.go` 实现 `Storage` 接口(封装厂商 SDK,对象 key 规则与 local 一致:uuid + 扩展名 + 可选前缀);
  2. `internal/config` 增 `{VENDOR}_*` 环境变量与校验,`.env.example` 补占位;
  3. `main.go` 装配 switch 加分支;
  4. `files.storage` 取值登记新驱动名。
     TOS(火山引擎)届时按此四步接入(其 SDK 或 S3 兼容模式均可),接口与表结构不变。

### COS 接入方案(本期)

- **SDK**:`github.com/tencentyun/cos-go-sdk-v5`。`Save` 用 `Object.Put`;不可寻址的 reader(网络请求体)先落临时文件,保证 Content-Length 确定;`Delete` 用 `Object.Delete`(缺失 key 按幂等成功处理);`Open` 用 `Object.Get`。
- **上传流程**(`media.Upload`):
  - 图片(≤10MB):先把请求体读入内存一次,`Save` 与宽高提取(`image.DecodeConfig`)复用同一份字节,**避免上传后再从 COS 回源 GET 一次**;
  - 视频(≤200MB):保持流式 `Save`,meta 暂无提取需求,不回源;
  - files 记录:`storage` 写当前驱动名,`url` 写 `driver.URL(key)`(CDN 完整地址;local 为空串)——**历史记录不随 CDN 域名配置漂移**;若日后更换 CDN 域名,用一条 SQL 按旧前缀批量刷新即可。
- **内容端点** `GET /files/{id}/content`:`files.url` 非空(OSS 记录)→ **302 重定向到 CDN 地址**;为空(local)→ 维持 `http.ServeContent`(保留 Range,视频可拖进度)。两种记录混合共存,历史 local 文件不受影响。
- **跨驱动删除守卫**:删除媒体只在"记录驱动 = 当前驱动"时删介质,随后删库;驱动切换后遗留的跨驱动记录只删记录、不碰介质(避免用错驱动误删/报错),遗留对象由运维按旧驱动另行清理。
- **驱动切换**:改 `STORAGE_DRIVER` + 重启即生效;local ↔ COS 可来回切,已上传记录各按各的 `url` 访问,不互相污染。
- **CDN 缓存注意**:删除媒体后 COS 源站对象即刻消失,但 CDN 边缘节点在 TTL 内仍可访问缓存副本;如需即时失效,后续接 CDN 刷新 API(用户侧的 `CDN_PURGE_URL_*` 属其既有刷新机制,本期不接)。

### 契约与数据变化

- `openapi/admin.yaml`:Image / Video 响应 schema 增加 `url`(string,required,CDN 直链;local 为空串);`ConfigGroup` 枚举去掉 `storage`(存储配置不再是配置组),configs 接口只剩 `system` 组。**无新端点,权限码不变**;
- `files` 表:新增 `url VARCHAR(512) NOT NULL DEFAULT ''`(AutoMigrate 加列,加法变更 SQLite/MySQL 双端安全);`storage` 取值扩展为 `local | cos`(tos 预留);
- seed:不再写入 storage 配置组,并在启动时清理阶段 6 之前入库的 storage 旧行(自愈,幂等)。

### admin 变化

- `useFileURL(fileId, directUrl)`:记录带 `url` 直接返回 CDN 直链(公开可读,无需 Bearer);无 `url` 走原 blob + Bearer 通道(本地文件)。图片/视频列表、预览、播放统一经此分支,页面对存储后端无感;媒体页 Item 类型改用生成物 `ImageAsset`/`VideoAsset`(消除手写重复类型);
- 系统设置页只有站点信息;存储配置不再是配置组,admin 无任何入口。

### COS 配置(用户已提供,落 `.env.local`)

- dev(本地开发,`.env.local`):Bucket `dev-user-profile-1348938418`,Region `ap-guangzhou`,前缀 `tmp/`,CDN `https://devcdn.ai4love.cn`;
- prod(部署时同名环境变量注入):Bucket `prod-ai4love-cos-1348938418`,前缀 `tmp/`,CDN `https://cdn.ai4love.cn`;
- 密钥同一对,仅存 `.env.local`;生产环境用部署平台的环境变量注入,不进任何仓库文件。

### 验收(**已通过**)

- `driver=cos`:冒烟实测——上传图片直传 COS,响应 `url` 为 CDN 直链,CDN 下载字节与原图逐一相同;`/files/{id}/content` 返回 302 到 CDN;删除后 COS 源站对象 404(CDN 边缘缓存属预期);操作日志埋点"上传图片 smoke.png(2x2)""删除图片 smoke.png"正常;
- `driver=local`:行为与阶段 5 一致(e2e 回归通过;playwright 起 server 时显式 `STORAGE_DRIVER=local`,不受本地 `.env.local` 影响);
- 单测:COS 实现以 httptest 桩覆盖 Save(含流式落盘)/Delete 幂等/Open 404 映射/URL 默认域名与前缀归一化;
- 密钥纪律:`.env.local` 被 gitignore,仓库只提交 `.env.example` 占位。

## 阶段 7:多受众契约拆分(admin / site;**已交付并验收**)

对外网站 app 消费 admin 配置的内容,Go 服务要同时提供公开 API。已落地:**按受众拆分契约,不拆 Go 服务**——`openapi/admin.yaml`(后台,JWT+RBAC)与 `openapi/site.yaml`(公开只读,路径带 `/site/v1` 前缀),一个二进制挂两条中间件链;首端点 `GET /site/v1/site-info`(站名/Logo,读 system 配置组,带 `Cache-Control: public, max-age=60`);`apps/site` 为最小 API 客户端脚手架(orval 生成,无鉴权 client)。

执行记录与完整手册(步骤 A 契约搬家、步骤 B site 链路与脚手架)见 [multi-audience-contracts.md](./multi-audience-contracts.md)。验收:无 token 访问 site 端点 200、admin 端点仍 401;swagger 双契约下拉;`pnpm verify` 全绿。后续对外端点按该文档"site 契约维护规则"累加,破坏性变更升 `/site/v2`。

## 阶段 8:URL 布局(网页 /admin、API /api/admin + /api/site;**已交付并验收**)

统一管理网页与 API 的 URL 空间,目标布局:

| 用途     | URL                                 | 承载                     |
| -------- | ----------------------------------- | ------------------------ |
| 对外网页 | `https://example.com/...`           | apps/site(未来真实网站)  |
| 后台网页 | `https://example.com/admin/...`     | apps/admin(SPA basename) |
| 后台 API | `https://example.com/api/admin/...` | admin 契约全部端点       |
| 对外 API | `https://example.com/api/site/...`  | site 契约(严格无版本位)  |
| Swagger  | `/swagger`(仅内网/可关)             | 根级,不进 API 前缀       |

### 决策(执行确认)

1. **API 前缀写进契约(字面),不做挂载期改写**:契约即部署真相——swagger 展示的就是生产路径;dev 代理从"rewrite 去前缀"简化为纯透传;网关规则退化为按前缀转发。admin.yaml 全部端点统一加 `/api/admin` 前缀(机械替换),site.yaml `/site/v1/*` → `/api/site/*`(阶段 7 的 `/site/v1` 约定自此修订)。
2. **site 严格无版本位**(用户确认):`/api/site/...` 不保留 v1;site 契约维护规则同步改为"只加不删,破坏性变更整体协商"。
3. **healthz 留在 admin 契约**,路径变 `/api/admin/healthz`(LB 探活打这个路径;`/swagger` 保持根级运维端点)。site 契约如需探活另行声明,不复用 admin 的。
4. **网页侧 = SPA basename + 网关静态路由**:已核实 Modern.js 用 `defineRuntimeConfig({ router: { basename } })`,配置文件**必须**叫 `src/modern.runtime.ts`(约定名 `modern.runtime`;写成别的名字会被**静默忽略**,basename 失效且 e2e 若不断言 URL 无法察觉——本阶段交付后踩过此坑,已靠 e2e URL 断言兜底);basename 与 `src/constants` 的 `APP_BASENAME` 同源;layout 统一以"剥离 basename 的应用内路径"做登录判断/面包屑/菜单高亮;生产构建 `assetPrefix=/admin/`(env 可覆盖,GitHub Pages 仓库 basePath 优先)。
5. **网关为唯一路由真相表**(生产 nginx 示例,执行后放 docs):

   ```nginx
   location /api/     { proxy_pass http://go-server:8080; }        # 两个受众的 API 都在其后
   location /swagger/ { proxy_pass http://go-server:8080; }        # 仅内网,或直接关 SWAGGER_ENABLED
   location /admin/   { root /srv/cms-admin; try_files $uri /admin/index.html; }
   location /         { root /srv/cms-site;  try_files $uri /index.html; }
   ```

   Go server 不托管任何网页静态资源;CDN 媒体直链不受影响。

### 变更清单

**契约**(机械):

- `openapi/admin.yaml`:所有 paths 键加 `/api/admin` 前缀(含 `/healthz`、`/auth/login`、`/files/{id}/content`);`openapi/site.yaml`:`/site/v1` → `/api/site`(无版本位);两份 info.description 的前缀约定同步。
- `pnpm gen:api` 后 server 路由、admin/site 客户端路径自动带前缀。

**server**:

- `internal/httpapi/permission.go` RoutePermissions 的 Pattern 全部加 `/api/admin` 前缀(**唯一事实源,漏一条全 403**,机械替换);
- `main.go`:jwtSkip → `/api/admin/healthz`、`/api/admin/auth/login`;挂载改为 `"/api/site/"` → 公开链、`"/api/admin/"` → 管理链,swagger 仍挂 root mux,其余路径 mux 默认 404(老无前缀 URL 一律 404 而非 401,语义更准);
- Go 测试走 service 层不受影响。

**admin app**:

- `src/api/client.ts`:`BASE_URL = "/api"` 删除(契约路径已自带 `/api/admin`),取消无外部消费者的 `getToken`/`setToken` 导出;
- `src/hooks/use-file-url.ts`:硬编码 `/api/files/...` → `/api/admin/files/...`;
- `modern.config.ts`:dev proxy 去掉 `pathRewrite`(`/api` 原样透传到 server,与生产一致);生产 `assetPrefix=/admin/`(env `ADMIN_ASSET_PREFIX` 可覆盖,GitHub Pages 仓库 basePath 优先);
- 路由 basename:新增 `src/modern.runtime.ts`(`defineRuntimeConfig` 的 `router.basename`,与 `src/constants` 的 `APP_BASENAME` 同源;注意约定文件名,写成 `runtime.config.ts` 会被静默忽略);**防呆**:`layout.tsx` 以剥离 basename 后的 `appPathname` 统一做登录页判断/面包屑/侧边栏高亮(`location.pathname === "/login"` 直比在 basename 下失效),并靠 e2e 的 URL 断言兜底 basename 生效;`navigate("/login")` 等编程式跳转由 basename 自动叠加,无需改;
- `config/menu.ts` 菜单 key 为应用内路径,basename 自动叠加,无需改。

**e2e / 工具链**:

- `playwright.config.ts`:健康检查 URL → `/api/admin/healthz`;e2e spec 的 `page.goto("/")` 改为 `/admin/`,断言 URL 同步;
- e2e admin webServer 仍用 `API_PROXY_TARGET` 指向 Go server,代理改透传后行为不变。

**docs**:api-pages 通用约定的"路径前缀"一节重写、接口表批量加前缀(机械);multi-audience-contracts.md 的前缀表述 `/site/v1` → `/api/site`(无版本位,加修订记录);README/AGENTS 无前缀依赖,无需改。

### 风险与防呆

- 权限注册表漏加前缀 → 全量 403:验收首条即登录后调 `/api/admin/users`;
- dev 代理 rewrite 残留 → 404;
- basename 下 `/login` 硬比较失效 → 用剥离 basename 的应用内路径判断;
- 老的 `/api/*` 无 `/admin` URL 直接废弃(一方消费者,无兼容负担),返回 404。

### 验收(**已通过**)

- 冒烟:无 token `/api/site/site-info` 200、`/api/admin/healthz` 200、`/api/admin/users` 401、登录后 200;老路径 `/users`、`/site/v1/site-info` 均 404;`/swagger/admin.yaml`、`/swagger/site.yaml` 匿名 200;
- 登录后 admin 全功能走 `/api/admin/*`,swagger 显示真实前缀路径;dev 代理为纯透传;
- admin 以 `/admin` basename 运行:e2e 经 `/admin` 完成全部流程(goto `/admin`、守卫跳转、菜单跳转、播放/上传),`pnpm verify` 全绿。

### 修补:basename 配置文件名(**待执行**)

**问题**:交付后实测发现 `/admin` 只在"直接访问时看起来能打开",点击任何路由跳转后 URL 掉回 `/system/users` 等裸路径——**basename 从未生效**。根因:运行时配置文件放错了名字。Modern.js app-tools 约定的运行时配置文件是 `src/modern.runtime.ts`(源码常量 `DEFAULT_RUNTIME_CONFIG_FILE = 'modern.runtime'`,见 `@modern-js/app-tools` dist),而我写的是 `src/runtime.config.ts`——内容正确、名字不在约定上,整个配置被**静默忽略**。e2e 全绿是假象:用例只断言页面内容、从未断言 URL,dev server SPA 兜底 + layout 守卫手动剥前缀把缺陷遮住了。

**执行顺序(红 → 绿)**:先加 URL 断言(此时 e2e 必然红),再改文件名(转绿)。不要反过来做。

**S1 给 e2e 补 URL 断言**(先加,加完跑 e2e 应当红——这就是防回归)。

在 `tests/playwright/demo-app.spec.ts` 中插入 4 处断言:

```ts
// 1. 登录守卫重定向后(goto("/admin") 之后,加在 heading 断言前):
await expect(page).toHaveURL(/\/admin\/login$/);

// 2. 登录成功后(点击"登录"之后,加在 hello heading 断言前):
await expect(page).toHaveURL(/\/admin\/?$/);

// 3. 菜单点击之后("用户管理" click 之后,加在 cell admin 断言前):
await expect(page).toHaveURL(/\/admin\/system\/users$/);

// 4. 退出登录之后(点击"退出登录"之后,加在登录页 heading 断言前):
await expect(page).toHaveURL(/\/admin\/login$/);
```

加完执行 `pnpm test:e2e` 确认第 1 条就红(证明断言有效、bug 真实存在),再继续。

**S2 改回约定文件名**(内容一行不动):

```bash
git mv apps/admin/src/runtime.config.ts apps/admin/src/modern.runtime.ts
```

Modern.js 按约定文件名自动加载(`.ts` 扩展名在探测范围内)。改完**必须重启 dev server** 才生效(`lsof -tiTCP:<端口> -sTCP:LISTEN | xargs kill -9`,再起)。

**S3 同步 admin 冒烟测试**(`apps/admin/tests/smoke.test.mjs`):

```ts
// 改前:
const runtimeConfigSource = await readFile(
  new URL("../src/runtime.config.ts", import.meta.url),
  "utf8"
);
// 改后:
const runtimeConfigSource = await readFile(
  new URL("../src/modern.runtime.ts", import.meta.url),
  "utf8"
);
```

**S4 文档更正**(本文件"决策(执行确认)"第 4 条与"变更清单 admin app"里的 `src/runtime.config.ts` 字样,均改为 `src/modern.runtime.ts`;并在决策 4 末尾补一句坑位说明:配置文件名不在 Modern.js 约定上会**静默失效**,必须靠 e2e 的 URL 断言兜底)。

**验收(DoD)**:

- [ ] e2e 四条 URL 断言在修复前红、修复后绿(即 `pnpm test:e2e` 通过且 URL 确实含 `/admin`);
- [ ] 真浏览器/探针复测:goto `/admin` → URL 保持 `/admin/login`;登录 → `/admin/`;点菜单 → `/admin/system/users`;退出 → `/admin/login`;
- [ ] 直访 `/admin/system/users`(已登录)正常,直访 `/`(根路径)不再渲染后台(basename 下 router 不匹配,交由对外站点);
- [ ] `pnpm verify` 全绿;提交信息:`fix: modern.js runtime config file name for /admin basename`。

**说明**:`layout.tsx` 剥离 basename 的应用内路径逻辑**保留不动**——真 basename 生效后 `useLocation().pathname` 仍包含 `/admin`,该逻辑与真 basename 互补;本修补只动文件名与测试。

## 种子数据

超管账号与超级管理员角色(全权限);初始菜单树(系统管理:用户/角色/菜单/日志/配置);示例字典(如 status 通用状态);初始站点配置。

## 跨阶段约定

- **契约先行**:每个接口先落 `openapi/` 下对应受众契约(admin → `admin.yaml`)→ `pnpm gen:api` → 再写实现;禁止跳过契约直接写 handler/前端类型;
- **权限码命名**:`模块:资源:动作`,如 `system:user:create`;菜单权限码同规范;
- **每阶段 DoD**:`pnpm verify` 全绿、Swagger UI 可演示当阶段接口、无手写重复类型、种子数据可重建;
- JWT 登出不失效是 MVP 取舍,需要立即失效时再加黑名单(后续迭代);
- 阶段 5 未启动前,涉及文件的场景(如 Logo)一律用 URL 字段过渡。
