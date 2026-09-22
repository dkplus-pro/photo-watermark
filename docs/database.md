# 数据库设计与 MySQL 迁移方案

表结构以 GORM 模型为唯一事实源,开发用 SQLite(零配置),生产切 MySQL,同一套模型双端建表。功能背景见 [mvp-plan.md](./mvp-plan.md)。

## 总体决策

| 项       | 决策                                                             | 理由                                                                                  |
| -------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 双轨存储 | dev: SQLite(glebarez 纯 Go 驱动);prod: MySQL 8.0+(go-sql-driver) | 纯 Go 驱动免 cgo,交叉编译部署不折腾                                                   |
| 建表机制 | GORM AutoMigrate,启动时执行                                      | 同一套模型自动生成对应方言 DDL;SQLite 开发库可随时删库重建                            |
| 外键     | **不建数据库外键**,关联完整性由 service 层守护                   | 规避 SQLite PRAGMA 开关与 MySQL 在线 DDL 的差异;关联清理集中在一个事务里,行为双端一致 |
| 删除语义 | 统一硬删除                                                       | 软删除 + 唯一索引在两端都有坑(重建同名账号线冲突);防误删由 service 层校验兜底         |
| 时间     | 统一存 UTC,`time.Time` 由 GORM 维护 `created_at`/`updated_at`    | 避免 SQLite TEXT 时间与 MySQL 时区比较差异                                            |
| 字符集   | MySQL 建库用 utf8mb4 / utf8mb4_0900_ai_ci;SQLite 天然 UTF-8      | utf8mb4 才能存 emoji 与全角字符                                                       |
| JSON     | 一律 `TEXT` + GORM `serializer:json`                             | 不用 MySQL JSON 列类型,双端行为一致                                                   |
| 表名     | 模型显式 `TableName()`,全小写复数                                | 不依赖 GORM 复数化推断,方言间稳定                                                     |

## 类型约定(便携规则)

字段类型只用以下映射,tag 必须写全,禁止裸 `string`(MySQL 端缺长度会建出 TEXT,影响索引):

| Go 模型写法                          | SQLite 实际 | MySQL 实际            | 用途                          |
| ------------------------------------ | ----------- | --------------------- | ----------------------------- |
| `int64` + `primaryKey;autoIncrement` | INTEGER PK  | BIGINT AUTO_INCREMENT | 所有表主键                    |
| `string` + `size:n`                  | TEXT        | VARCHAR(n)            | 一切定长上限字段              |
| `string` + `type:text`               | TEXT        | TEXT                  | 长文本(配置 JSON 等)          |
| `bool`                               | INTEGER 0/1 | TINYINT(1)            | 状态、开关                    |
| `int`                                | INTEGER     | INT                   | sort、status_code、latency_ms |
| `time.Time`(可空用 `*time.Time`)     | TEXT(UTC)   | DATETIME(3)           | 全部时间字段                  |

## 表结构明细

### users — 用户

| 字段                    | 类型               | 说明                   |
| ----------------------- | ------------------ | ---------------------- |
| id                      | PK int64           |                        |
| username                | VARCHAR(64) UNIQUE | 登录名,唯一索引        |
| password_hash           | VARCHAR(100)       | bcrypt(60 字符,留余量) |
| nickname                | VARCHAR(64)        | 显示名                 |
| email                   | VARCHAR(128)       | 可空串                 |
| status                  | bool,默认 1        | 1 启用 / 0 禁用        |
| last_login_at           | *time.Time         | 登录成功时更新         |
| created_at / updated_at | time.Time          |                        |

### roles — 角色

| 字段                    | 类型               | 说明                  |
| ----------------------- | ------------------ | --------------------- |
| id                      | PK                 |                       |
| code                    | VARCHAR(64) UNIQUE | 如 `super_admin`      |
| name                    | VARCHAR(64)        | 显示名                |
| remark                  | VARCHAR(255)       |                       |
| status                  | bool,默认 1        |                       |
| is_builtin              | bool,默认 0        | 内置角色不可删改 code |
| created_at / updated_at |                    |                       |

### user_roles — 用户 ↔ 角色

| 字段              | 类型  | 说明                                    |
| ----------------- | ----- | --------------------------------------- |
| id                | PK    |                                         |
| user_id / role_id | int64 | UNIQUE(user_id, role_id);INDEX(role_id) |

### permissions — 权限点(menu / api 统一)

| 字段                    | 类型                | 说明                                     |
| ----------------------- | ------------------- | ---------------------------------------- |
| id                      | PK                  |                                          |
| code                    | VARCHAR(128) UNIQUE | `模块:资源:动作`,如 `system:user:create` |
| name                    | VARCHAR(64)         | 展示名,如"创建用户"                      |
| type                    | VARCHAR(16)         | `menu` / `api`;INDEX(type)               |
| parent_id               | int64,默认 0        | 组树:menu 随菜单层级,api 按模块分组      |
| sort                    | int,默认 0          |                                          |
| created_at / updated_at |                     |                                          |

### role_permissions — 角色 ↔ 权限

| 字段                    | 类型  | 说明                                                |
| ----------------------- | ----- | --------------------------------------------------- |
| id                      | PK    |                                                     |
| role_id / permission_id | int64 | UNIQUE(role_id, permission_id);INDEX(permission_id) |

### operation_logs — 业务操作日志(只增;方案见 mvp-plan.md 阶段 4 修订)

记录"谁在什么时间对什么对象做了什么、结果如何",给运营看;由 service 层在增删改与登录处显式埋点(查询不记),HTTP 访问日志不入库(见下节)。

| 字段        | 类型         | 说明                                                                      |
| ----------- | ------------ | ------------------------------------------------------------------------- |
| id          | PK           |                                                                           |
| user_id     | int64        | 0 = 未登录(如登录失败尝试)                                                |
| username    | VARCHAR(64)  | 冗余快照,用户删除后仍可读;登录失败记尝试的登录名                          |
| action      | VARCHAR(64)  | `资源.动作`,如 user.delete / role.assignPermissions                       |
| resource    | VARCHAR(64)  | 资源类型,如 user / role / config / dictEntry                              |
| resource_id | VARCHAR(64)  | 资源标识,统一字符串(数字 id 或 group 名)                                  |
| description | VARCHAR(255) | 人话描述,含对象名,如"删除用户 张三(zhangsan)"                             |
| status      | VARCHAR(16)  | success / failed                                                          |
| ip          | VARCHAR(45)  | 兼容 IPv6                                                                 |
| created_at  |              | INDEX(created_at);INDEX(user_id, created_at);INDEX(resource, resource_id) |

保留策略:业务日志是审计数据,**长期保留**,MVP 不做清理。

兼容性:SQLite 不允许给旧表追加无默认值的 NOT NULL 列;启动时检测到修订前的旧结构(含 method/status_code/latency_ms 列)会自动删表重建——历史访问日志本就走文件且无保留价值,不做迁移。MySQL 上线后出现同类破坏性变更需改用迁移工具(见"上线后的演进")。

### HTTP 访问日志(开发用,不入库)

方法/路径/状态码/耗时这类请求级日志只服务开发排查:以 `slog` 结构化输出到 stdout,并写入按天滚动的文件 `apps/server/logs/server-YYYY-MM-DD.log`;启动时删除超过保留天数(`ACCESS_LOG_RETAIN_DAYS`,默认 7)的旧文件。无查询接口、无表;`logs/` 目录加入 .gitignore。

### files — 文件

| 字段        | 类型         | 说明                                                        |
| ----------- | ------------ | ----------------------------------------------------------- |
| id          | PK           |                                                             |
| orig_name   | VARCHAR(255) | 原始文件名                                                  |
| name        | VARCHAR(128) | 存储名 / 对象 key(uuid + 扩展名,可带厂商前缀)               |
| path        | VARCHAR(255) | 相对路径 / 对象 key                                         |
| mime        | VARCHAR(64)  |                                                             |
| size        | int64        | 字节                                                        |
| storage     | VARCHAR(16)  | 驱动名:`local` / `cos`(tos 预留;见 mvp-plan.md 阶段 6)      |
| url         | VARCHAR(512) | 外网访问地址(CDN 直链);local 为空串,AutoMigrate 加列默认 '' |
| uploader_id | int64        | 0 = 系统                                                    |
| created_at  |              |                                                             |

### media_assets — 媒体资源(类型化上层;方案见 mvp-plan.md 阶段 5 修订)

底层 files 只管存取,上层按媒体类型记录提取的信息;admin 只暴露图片/视频,音频同表预留。

| 字段                    | 类型         | 说明                                                                |
| ----------------------- | ------------ | ------------------------------------------------------------------- |
| id                      | PK           |                                                                     |
| kind                    | VARCHAR(16)  | image / video / audio;INDEX(kind)                                   |
| file_id                 | int64        | 关联 files(存取与介质删除都经底层)                                  |
| title                   | VARCHAR(255) | 展示标题,默认原始文件名                                             |
| meta                    | TEXT         | 提取信息 JSON:图片 width/height/format;视频预留 duration/resolution |
| uploader_id             | int64        | 0 = 系统                                                            |
| created_at / updated_at |              |                                                                     |

查询列表 JOIN files 取大小/原始文件名;删除媒体时级联删除 files 记录与介质文件。后续按类型扩展提取信息只动 Extractor 与 meta,不改表结构。

### sys_configs — 系统配置(KV)

| 字段                    | 类型                   | 说明                       |
| ----------------------- | ---------------------- | -------------------------- |
| id                      | PK                     |                            |
| group                   | VARCHAR(32)            | 目前仅 `system`            |
| key                     | VARCHAR(64)            | UNIQUE(group, key)         |
| value                   | TEXT + serializer:json | 结构化 JSON,模型侧反序列化 |
| remark                  | VARCHAR(255)           | 用途说明                   |
| updated_by              | int64                  | 最后修改人                 |
| created_at / updated_at |                        |                            |

存储配置不入库:曾以 `storage` 配置组存放 driver/basePath,阶段 6 起整体迁到环境变量(密钥只允许留在本地 `.env.local`,见 mvp-plan.md 阶段 6);启动种子会清理库中残留的 storage 组旧行(自愈,幂等)。

### dicts / dict_items — 字典

dicts:id, code VARCHAR(64) UNIQUE, name VARCHAR(64), remark VARCHAR(255), status bool, created_at / updated_at。
dict_items:id, dict_id int64(INDEX), label VARCHAR(64), value VARCHAR(64), sort int, status bool, created_at / updated_at;UNIQUE(dict_id, value)。

## 关系与完整性

关联只有三条 N-N/N-1:users↔roles(user_roles)、roles↔permissions(role_permissions)、dict_items→dicts(dict_id);media_assets→files(file_id,删除媒体级联删文件);logs 与 files 本身只冗余存 id/用户名快照,不构成强关联。

没有数据库外键,service 层在删除时必须守护(均在同一事务内):

- 删用户:先清 user_roles;禁止删自己与内置管理员;
- 删角色:仍有用户绑定时拒绝;
- 删菜单:有子菜单拒绝;同步删除其绑定的 menu 权限点及 role_permissions 引用;
- 删字典:级联删 dict_items;
- 删文件:先删存储介质上的对象,成功后再删记录。

## repo 层接入

```go
// internal/repo/db.go — 驱动由配置切换,DSN 透传
func Open(cfg config.Database) (*gorm.DB, error) {
    switch cfg.Driver {
    case "sqlite":
        return gorm.Open(sqlite.Open(cfg.DSN), &gorm.Config{}) // dev: apps/server/data/cms.db
    case "mysql":
        return gorm.Open(mysql.Open(cfg.DSN), &gorm.Config{})
    }
}
```

启动时对全部模型执行 AutoMigrate(固定顺序,幂等);种子数据按唯一键 upsert,可重复执行。

## 迁移到 MySQL(上线方案)

### 切换步骤

1. 建库:`CREATE DATABASE cms CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`,账号授权;
2. 配置 `driver=mysql`,DSN 形如 `user:pass@tcp(host:3306)/cms?charset=utf8mb4&parseTime=true&loc=UTC`;
3. 启动服务:AutoMigrate 建表 → 种子脚本幂等补齐;
4. 冒烟:`/healthz`、登录、`/swagger` 走一遍,确认时间字段时区正确(库内 UTC,展示层转本地)。

开发库数据默认不迁移:CMS 模板的生产环境从种子数据起步,数据搬运仅在确有存量价值时执行。

### 存量数据搬运(可选)

提供一次性工具 `cmd/datamove`:同一套模型开两个 GORM 连接(源 SQLite / 目标 MySQL),按表逐行**显式带 id upsert**——保留原 id,日志与关联不漂移,MySQL 自增水位自动越过最大 id。幂等可重跑,适合停机窗口内执行。

### 上线后的演进

- AutoMigrate 只做加法(加列、加索引),不改、不删;
- 出现破坏性变更(改类型/重命名/删列)时引入 golang-migrate:迁移 SQL 只需 MySQL 版(开发用 SQLite 删库重建 + 模型同步即可),变更流程固化为"改模型 → 破坏性操作落迁移文件";
- 任何时刻模型与库结构必须一致,schema 变更不留口头约定。

### 兼容性红线(开发期就要遵守)

- 不写裸方言 SQL:日期筛选用时间范围参数(`created_at >= ? AND created_at < ?`),不用 `date()`/`DATE_FORMAT()`;
- 不用 MySQL JSON 列、SQLite 生成列等单端特性;
- 布尔只存 0/1,字符串比较不做大小写不敏感查询(唯一性靠 UNIQUE 索引 + 服务层校验);
- 一切查询走 GORM 或参数化 SQL,禁止字符串拼接。
