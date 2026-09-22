# 接口与页面清单(MVP 全量核对表)

本清单是 [mvp-plan.md](./mvp-plan.md) 的落地核对表:接口的具体 schema 以 `openapi/admin.yaml` 契约为准(本清单只做索引,不复述字段),两者必须在同一个 PR 内同步演进。页面实现遵循 [admin.md](./admin.md);多受众契约说明见 [multi-audience-contracts.md](./multi-audience-contracts.md)。

## 通用约定

- **路径前缀**:契约路径字面带前缀(admin 契约全部 `/api/admin`,site 契约 `/api/site`,见 [multi-audience-contracts.md](./multi-audience-contracts.md));dev 代理把 `/api` 原样透传到 server(8080),client.ts 不再设 baseURL;
- **认证**:`Authorization: Bearer <token>`;标注"免认证"的除外(/healthz、/auth/login、/swagger);
- **权限码**:标注"登录"表示仅需有效 token,其余按 RBAC 权限码校验(见下方权限点汇总);
- **分页**:入参 `page`、`pageSize`,返回 `{list, total}`;
- **错误码**:400 参数错误 / 401 未登录或 token 失效 / 403 无权限 / 404 资源不存在 / 409 业务冲突(用户名重复、角色仍被绑定等)/ 500 服务端错误。

## 接口清单(42 个)

### 公共(阶段 0:1 个)

| 方法 | 路径                         | 说明 | 权限码 |
| ---- | ---------------------------- | ---- | ------ |
| GET  | /api/admin/api/admin/healthz |

### auth 认证与账号(阶段 1:4 个;阶段 3:1 个)

| 方法 | 路径                               | 说明 | 权限码 |
| ---- | ---------------------------------- | ---- | ------ |
| POST | /api/admin/auth/login              |
| POST | /api/admin/auth/logout             |
| GET  | /api/admin/auth/me                 |
| PUT  | /api/admin/api/admin/auth/password |

### users 用户(阶段 2:7 个)

| 方法   | 路径                                   | 说明 | 权限码 |
| ------ | -------------------------------------- | ---- | ------ |
| GET    | /api/admin/users                       |
| POST   | /api/admin/users                       |
| GET    | /api/admin/users/{id}                  |
| PUT    | /api/admin/users/{id}                  |
| DELETE | /api/admin/users/{id}                  |
| PATCH  | /api/admin/api/admin/users/{id}/status |
| PUT    | /api/admin/users/{id}/roles            |

### roles 角色 + permissions 权限点(阶段 2:8 个)

| 方法   | 路径                                        | 说明 | 权限码 |
| ------ | ------------------------------------------- | ---- | ------ |
| GET    | /api/admin/roles                            |
| GET    | /api/admin/roles/all                        |
| POST   | /api/admin/roles                            |
| GET    | /api/admin/roles/{id}                       |
| PUT    | /api/admin/roles/{id}                       |
| DELETE | /api/admin/roles/{id}                       |
| PUT    | /api/admin/api/admin/roles/{id}/permissions |
| GET    | /api/admin/permissions                      |

### operation-logs 业务操作日志(阶段 4:1 个;方案见 mvp-plan.md 阶段 4 修订)

| 方法 | 路径                                | 说明 | 权限码 |
| ---- | ----------------------------------- | ---- | ------ |
| GET  | /api/admin/api/admin/operation-logs |

### configs 系统配置(阶段 4:2 个)

| 方法 | 路径                                 | 说明 | 权限码 |
| ---- | ------------------------------------ | ---- | ------ |
| GET  | /api/admin/api/admin/configs/{group} |
| PUT  | /api/admin/api/admin/configs/{group} |

### dicts 字典(阶段 4:10 个)

| 方法   | 路径                                             | 说明 | 权限码 |
| ------ | ------------------------------------------------ | ---- | ------ |
| GET    | /api/admin/dicts                                 |
| POST   | /api/admin/dicts                                 |
| PUT    | /api/admin/dicts/{id}                            |
| DELETE | /api/admin/dicts/{id}                            |
| PATCH  | /api/admin/dicts/{id}/status                     |
| PUT    | /api/admin/dicts/{id}/entries                    |
| GET    | /api/admin/dicts/{code}/items                    |
| POST   | /api/admin/dicts/{code}/items                    |
| PUT    | /api/admin/api/admin/dicts/{code}/items/{itemId} |
| DELETE | /api/admin/api/admin/dicts/{code}/items/{itemId} |

> 字典项不设独立权限码,统一归入 `system:dict:update`(字典管理页内的动作)。

### media 媒体资源(阶段 5,可后置;方案见 mvp-plan.md 阶段 5 修订:8 个 + content 1 个)

底层为通用文件存储(files + storage 接口),上层按类型化媒体接口暴露;admin 只做图片/视频管理,不做通用文件管理页。音频(/audios)规划预留,本期不落契约。

| 方法   | 路径                                    | 说明 | 权限码 |
| ------ | --------------------------------------- | ---- | ------ |
| POST   | /api/admin/images                       |
| GET    | /api/admin/images                       |
| GET    | /api/admin/images/{id}                  |
| DELETE | /api/admin/images/{id}                  |
| POST   | /api/admin/videos                       |
| GET    | /api/admin/videos                       |
| GET    | /api/admin/videos/{id}                  |
| DELETE | /api/admin/videos/{id}                  |
| GET    | /api/admin/api/admin/files/{id}/content |

阶段 6(对象存储接入,方案见 mvp-plan.md)对本块的增量,端点与权限码不变:

- Image / Video 响应 schema 增加 `url` 字段(CDN 直链;local 存储为空串),admin 展示优先用 `url`,空串回退 content 端点;
- `GET /files/{id}/content` 对 `files.url` 非空的记录(OSS)改为 **302 重定向**到 CDN 地址,local 记录维持流式输出(保留 Range)。

## site 对外接口(阶段 7,公开只读)

契约在 `openapi/site.yaml`(与 admin 拆分,方案见 [multi-audience-contracts.md](./multi-audience-contracts.md)):路径自带 `/site/v1` 前缀,**无鉴权**、仅 GET、DTO 按对外裁剪、媒体字段直出 CDN 直链;响应信封约定与 admin 相同。公网网关只放行此前缀,后台路径仅内网。

| 方法 | 路径                | 说明                                       | 权限       |
| ---- | ------------------- | ------------------------------------------ | ---------- |
| GET  | /api/site/site-info | 站点公开信息(站名/Logo,来自 system 配置组) | 公开(匿名) |

## 权限点汇总

- **api 权限点 27 个**(上表权限码去重):user 5、role 5、menu 4、log 1、config 2、dict 4、media 6;以 server 路由注册表为源,启动时 upsert 进 permissions(type=api);
- **menu 权限点**:与前端静态菜单一一对应,code 形如 `menu:system:user`,由服务端路由注册表在启动时创建,用于角色授权树分组与菜单显隐;
- 分配权限弹窗展示为一棵树:菜单节点(menu 点)下挂对应模块的 api 点。

## 页面清单(9 个业务页 + 登录页)

| 路由            | 页面           | 阶段      | 页面内弹窗/子组件                              | 依赖接口                  |
| --------------- | -------------- | --------- | ---------------------------------------------- | ------------------------- |
| /login          | 登录页         | 1         | —                                              | auth/login                |
| /               | 欢迎页(占位)   | 0         | —                                              | —                         |
| /system/users   | 用户管理       | 2         | 新建/编辑弹窗、分配角色弹窗、状态 Switch       | users 全部 7 个           |
| /system/roles   | 角色管理       | 2         | 新建/编辑弹窗、分配权限弹窗(Tree)              | roles 7 个 + /permissions |
| /system/logs    | 操作日志(业务) | 4         | 详情抽屉;列:操作人/动作/资源/描述/结果/IP/时间 | operation-logs            |
| /system/configs | 系统设置       | 4         | 站点信息(存储配置已迁环境变量,见阶段 6)        | configs 2 个              |
| /system/dicts   | 字典管理       | 4         | 字典表单弹窗、字典项表单弹窗(左右布局)         | dicts 8 个                |
| /media/images   | 图片管理       | 5(可后置) | 上传弹窗、预览大图                             | images 4 个 + content     |
| /media/videos   | 视频管理       | 5(可后置) | 上传弹窗、内嵌播放                             | videos 4 个 + content     |

全局件(不算独立页面):布局壳(侧边栏/顶栏/面包屑,阶段 0)、修改密码弹窗(阶段 1)、404 兜底路由与 403 无权限提示块(阶段 0/2)。

弹窗合计 9 个:用户×2、角色×2、字典×2、图片上传×1、视频上传×1、修改密码×1。

### 预判抽取的公共件(出现第二个用例即提升,见 admin.md 复用规则)

- `useTableQuery` — 列表页通用逻辑:分页 + 筛选参数 + 请求与刷新(users/roles/logs/files/dicts 共 5 处);
- `usePermission` / `<AuthButton>` — 按权限码控制按钮显隐(所有管理页);
- 表格操作列、状态 Tag 等,先在各页面私有实现,复用需求出现后再提升。

## 使用方式

1. 新增/变更接口:先改本清单 → 落 `openapi/admin.yaml`(对外站点接口落 `site.yaml`)→ `pnpm gen:api` → 前端直接调用生成函数(零手写)、后端补 handler/service/repo,清单与契约同一 PR;
2. 排期核对:阶段交付时按下表打勾——接口 42 个、页面 10 个路由(9 业务 + 登录)、弹窗 9 个;
3. 页面开发顺序 = 表格"依赖接口"列就绪即可开工,不依赖后端整体完成。
