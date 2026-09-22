# Admin 后台增强分阶段计划(阶段 9-14)

本计划承接 [mvp-plan.md](./mvp-plan.md)(阶段 0-8 已交付并验收),覆盖 MVP 之后的后台增强需求。开发纪律不变:契约先行(先改 `openapi/` 对应受众契约 → `pnpm gen:api` → 再写实现)、生成物禁手改、每阶段 DoD 为 `pnpm verify` 全绿;"怎么写代码"遵循 [development.md](./development.md)、[admin.md](./admin.md)、[server.md](./server.md)。

## 需求 → 阶段映射

| 需求(原始清单)                                                      | 阶段 |
| ------------------------------------------------------------------- | ---- |
| 菜单折叠失效,修复                                                   | 9    |
| 新增 ErrorBoundary 组件,最外层 catch                                | 9    |
| response 有 logID,服务端打日志                                      | 9    |
| XSS、CSRF 防御接入                                                  | 10   |
| UI 优化并形成规范进 Agent 规范(菜单图标/面包屑/分页/列表与表单范式) | 11   |
| Dashboard 页接入(VChart,mock 数据 + TODO)                           | 12   |
| 媒体资源分组功能                                                    | 13   |
| 大文件分片上传                                                      | 14   |

## 阶段总览

| 阶段 | 主题                     | 规模 | 前置 | 可并行                         |
| ---- | ------------------------ | ---- | ---- | ------------------------------ |
| 9    | 稳定性与可观测性         | S-M  | —    | server(logID)与 admin 侧可并行 |
| 10   | 安全基线(XSS / CSRF)     | S    | 9    | 与 11 并行                     |
| 11   | UI 规范与全量改版        | M-L  | 9    | 与 10 并行                     |
| 12   | Dashboard(VChart + mock) | S    | 11   | 与 13 并行                     |
| 13   | 媒体资源分组             | M    | 11   | 与 12 并行                     |
| 14   | 大文件分片上传           | L    | 13   | —                              |

规模:S ≈ 1-2 天,M ≈ 3-4 天,L ≈ 5-7 天。排序原则:先修阻塞性 bug 与可观测性(logID 是后续所有阶段排查问题的工具),再落安全与 UI 基线,最后做功能(分组 → 分片上传,两者都动上传弹窗,按序做避免返工)。

## 阶段 9:稳定性与可观测性(菜单折叠 · ErrorBoundary · logID;**已交付并验收**)

> **交付记录**:菜单受控回调按仓库实际 Arco 2.66.16 的 API 用 `onClickSubMenu` 第二参同步 `openKeys`(计划所写 `onOpenKeys` 在该版本不存在,typecheck 证实),意图一致;logID 采用 ResponseWriter wrapper 方案(接口断言穿透 Unwrap 链读取 logID),handler 调用点零改动;e2e 起的 server 需显式 `CSRF_ALLOWED_ORIGINS=http://127.0.0.1:18080`(阶段 10 中间件的联带配置)。

### A. 菜单折叠失效修复(bug)

**根因**(已定位):`apps/admin/src/routes/layout.tsx` 中侧边栏 `Menu` 传入了受控 `openKeys`,但**没有实现 `onOpenKeys` 回调**——受控模式下点击目录标题的状态变化无人处理,展开/收起完全失效;且权限码就绪后 `useEffect` 每次都把全部目录强制展开。

**修复方案**:

- `Menu` 增加 `onOpenKeys={setOpenKeys}`,用户点击目录正常展开/收起;
- "权限就绪后默认全展开"只在**首次初始化**时执行一次(用 ref 标记已初始化),切换账号/重新登录时重置标记再初始化;
- 整栏折叠(左侧栏收窄为图标模式)不在本阶段,归阶段 11(依赖菜单图标,折叠态仅显示图标才有意义)。

验收:点击"系统管理/媒体管理"目录可展开、可收起;权限变化/切换账号后菜单显隐正确且目录默认展开一次;e2e 补目录点击断言。

### B. ErrorBoundary 最外层兜底

- `src/components/error-boundary.tsx`:类组件实现 React ErrorBoundary(React 19 下官方边界仍是类组件方案,不引第三方库);
- **两层放置**:
  - 根级:`layout.tsx` 的 `Layout` 内包裹 `<AppShell />`,兜住壳层渲染错误(Provider 之下、壳之上);
  - 页面级:`Content` 内包裹 `<Outlet />`,页面崩溃时侧边栏/顶栏仍可用,fallback 显示错误卡片(错误摘要、重试按钮=重置边界 state、返回首页),**不吞错误**(`console.error` 保留原始堆栈);
- fallback 复用 Arco(`Result`/`Button`),样式走 Arco token,不写死颜色。

验收:人为在任一页面渲染中 throw,壳与导航保持可用,错误卡片可"重试/返回首页";`pnpm verify` 全绿。

### C. logID 全链路(响应带 logID,服务端日志可关联)

**方案**:

- server 新增 `httpapi.RequestID()` 中间件,**挂两条链最外层**(admin + site):
  - 请求头 `X-Request-Id` 已存在且合法(`^[A-Za-z0-9-_]{8,64}$`,防日志注入)则透传(网关生成),否则服务端生成短 ID;
  - 写响应头 `X-Log-Id`、注入 `context`;
- 响应包装升级:`WriteJSON`/`WriteError` 增加 `ctx` 参数,从 context 取 logID,envelope 变为 `{code, message, data, logID}`(错误响应 `{code, message, logID}`)——**加法变更**,admin 的 `isEnvelope` 判定(`code` + `data` 同时存在)不受影响;调用点在 `internal/httpapi` 包内,机械替换;
- 访问日志(`Logging` 中间件)与 panic 日志(`Recover`)每行带 `log_id`,支持按 logID 在 `logs/` 滚动文件里检索一次请求的完整链路;
- admin `src/api/client.ts`:错误提示追加 logID——`readErrorMessage` 读到 `logID`(payload 字段或 `X-Log-Id` 响应头)时,Message 文案拼接 `(logID: xxx)`,用户报障时可复制给开发直查服务端日志;
- 契约:两份契约 `info.description` 的响应包装说明补 `logID` 字段(纯文档变更,无 schema 变化,生成物不动)。

验收:curl 任意接口,响应体 `logID` 与响应头 `X-Log-Id` 一致,访问日志行含同一 `log_id`;前端任意报错 toast 含 logID;透传网关 `X-Request-Id` 生效。

## 阶段 10:安全基线(XSS / CSRF 防御;**已交付并验收**)

### 威胁模型(先说清楚)

当前认证是 **JWT Bearer + localStorage + `Authorization` 请求头**:跨站页面/表单无法附加自定义头,服务端也不读 Cookie,经典 CSRF(依赖 Cookie 自动携带)结构上不成立。因此防御分三层,并把这个前提写成硬约束:

1. **结构性防御(最重要)**:保持 Bearer 方案;**禁止迁往 Cookie 会话**——若未来迁 Cookie,必须同步落地 `SameSite=Lax/Strict` + CSRF token,否则不得合并(写入 docs/server.md);
2. **Origin 校验(纵深)**:非安全方法(GET/HEAD/OPTIONS 之外)且请求带 `Origin` 头时,必须命中白名单,否则 403;不带 `Origin` 的非浏览器调用(curl、服务间)放行;
3. **安全响应头**:见下。

### server

- 新增 `httpapi.OriginCheck(allowedOrigins []string)` 中间件,挂 **admin 链**(site 链公开只读,无 unsafe 方法,不挂):
  - 白名单来自环境变量 `CSRF_ALLOWED_ORIGINS`(逗号分隔),**默认 `http://localhost:8081`**(dev 代理下 admin 的 Origin 就是它,开箱即用;dev 代理 `changeOrigin` 只改 Host 不改 Origin);
  - 生产部署注入真实域名(如 `https://example.com`);`.env.example` 补占位与说明;
- 新增 `httpapi.SecurityHeaders()` 中间件,admin + site 两条链都挂:
  - `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、`Cache-Control: no-store`(鉴权数据不经共享缓存);
  - Swagger 页面按需放宽(它要加载自身静态资源),CSP 暂不施加,留 TODO;
- Go `encoding/json` 默认对 `<>&` 做 HTML 转义,XSS 注入面主要在前端渲染层(React 默认转义已覆盖)。

### admin

- 生产构建注入 CSP meta(`modern.config.ts` 的 `html` 配置,**仅生产**——dev 的 HMR 与 eval 会被 CSP 破坏):
  `script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'`
  (Arco 大量内联 style,`style-src` 需 `'unsafe-inline'`;媒体 CDN 走 `https:`;托管层 nginx/Pages 的响应头 CSP 作为权威配置,meta 为兜底,部署示例写入 docs);
- 代码纪律(写进 docs/admin.md + AGENTS.md):**禁用 `dangerouslySetInnerHTML`**;未来有富文本需求时先引 DOMPurify 再开;渲染媒体/外链 URL 时限定 `http(s)` 协议(防 `javascript:` 伪协议)。

### 测试与验收

- Go 单测覆盖 OriginCheck 矩阵(白名单命中/未命中 403/无 Origin 放行/安全方法跳过);
- e2e 回归同源请求(带合法 Origin)全部 200;`pnpm verify` 全绿。

## 阶段 11:UI 规范与全量改版(先沉淀规范,再改存量;**已交付并验收**)

> **交付记录**:`config/menu.ts` 改名 `menu.tsx`(icon 是 JSX 元素,.ts 无法承载,smoke 测试路径断言同步);媒体页契约暂无筛选参数,本期只对齐 PageContainer 与全量分页(要筛选先落契约)。

### 第一步:规范落文档(先于代码)

**docs/admin.md「UI 规范」重写为细则**,核心条款:

| 项       | 规范                                                                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 菜单图标 | 菜单项必须声明图标(`config/menu.ts` 的 `MenuConfig` 增加 `icon` 字段);整栏可折叠,折叠态仅显示图标                                                                                                    |
| 面包屑   | 面包屑与页头放在**内容区顶部**(PageHeader 模式),不放顶栏;顶栏只保留用户区                                                                                                                            |
| 分页     | 统一全量分页:`showTotal`(共 x 条)+ `showPageSize`/`sizeCanChange`(10/20/50/100)+ `showJumper`;切 pageSize 重置回第 1 页                                                                              |
| 列表页   | 照抄 [arco-pro search-table](https://react-pro.arco.design/list/search-table):`Card` + 查询 `Form` + `Table` + `Pagination`,含重置按钮、loading、空态                                                |
| 表单     | 按复杂度二分:简单(单组、字段少)用 `Modal` + `Form`;复杂(多分组/长表单)用**分组表单页**——[arco-pro form/group](https://react-pro.arco.design/form/group) 范式:`Card` 分组 + 底部固定操作栏(提交/重置) |

**AGENTS.md(admin 段)追加硬规则摘要**(让 Agent 每次做 admin 工作都强制遵守):

- 菜单项必须带图标,新菜单禁止裸文字;
- 新页面必须套 `PageContainer`(面包屑/标题在内容区,禁止放顶栏);
- 列表分页必须全量(总数 + 每页数量切换 + 跳页);
- 列表页照抄 search-table 范式;表单按"简单 Modal / 复杂分组表单页"二分。

### 第二步:公共设施(沉淀后全页面复用)

- `src/components/page-container.tsx`:面包屑(自动取 `menu.ts` 标题链:首页 / 系统管理 / 用户管理)+ 标题 + 右侧操作区;layout 的 Header 移除 Breadcrumb;
- `src/hooks/use-table-query.ts`:统一分页状态编排(page/pageSize/total/pagination props/重置页码),各列表页不再手写;
- `config/menu.ts` 全量配图标(建议:`仪表盘 IconDashboard`、`系统管理 IconSettings`、`用户 IconUser`、`角色 IconUserGroup`、`日志 IconHistory`、`配置 IconTool`、`字典 IconBook`、`媒体管理 IconFolder`、`图片 IconImage`、`视频 IconVideoCamera`;以 `@arco-design/web-react/icon` 实际导出为准);
- 侧边栏整栏折叠:顶部折叠触发器(`IconMenuFold`/`IconMenuUnfold`),折叠宽度 60,菜单项 Tooltip 显示标题。

### 第三步:存量页面改版(全部对齐规范)

- 列表页(users/roles/logs/dicts)对齐 search-table:查询条件入 `Form`、间距/按钮区按范式、全量分页;
- 媒体页(images/videos)查询区与分页对齐规范(网格布局保留);
- **系统配置页(configs)改造为分组表单页范例**:PageContainer + `Card` 分组(站点信息一组)+ 底部提交栏——作为复杂表单规范的落地样板,后续新表单页照此;
- 登录后欢迎页的替换归阶段 12,本阶段不动。

验收:所有列表页分页含总数与 pageSize 切换;面包屑在内容区;菜单全量带图标且整栏可折叠;规范已进 docs/admin.md 与 AGENTS.md;`pnpm verify` 全绿。

## 阶段 12:Dashboard 页(VChart + mock 数据;**已交付并验收**)

> **交付记录**:VChart 仅存在于 `/` 路由异步 chunk(约 2.2MB / gzip 600KB),主包零增长(生产构建验证);统计卡三项真实 total + 存储用量 mock;mock queryKey 待落契约时迁入 queryKeys.ts 并换 `DashboardController.summary()`(TODO 已注明)。

- **依赖**:`@visactor/react-vchart`(React 封装)+ `@visactor/vchart-arco-theme`(Arco 主题适配,入口执行一次 `initVChartArcoTheme()`,自动跟随 Arco 亮暗主题——见 [Arco × VChart 官方指引](https://arco.design/react/docs/vchart));
- **页面**:`routes/page.tsx`(现欢迎页)改为 Dashboard,菜单首项"仪表盘"(`/`)+ 图标:
  - 第一行统计卡片:用户总数 / 图片总数 / 视频总数(走既有接口的 `total`,**真实数据**)+ 存储用量(mock);
  - 第二行图表:近 30 天上传趋势(折线,mock)、媒体类型分布(饼图,mock);
- **mock 纪律**:数据集中在 `src/routes/dashboard/mock.ts`,页面经 `useDashboardData` hook 消费(`useQuery` 的 queryFn 返回 mock);**TODO 注释标明**:待 `GET /api/admin/dashboard/summary` 落契约后替换 queryFn,页面结构不动。本期**不落契约**、不造假接口;
- **体积控制**:VChart 体积大,图表组件只在 dashboard 路由 chunk 内引入(路由级代码分割天然隔离),不进主包;
- 图表容器自适应宽度(VChart autoFit)。

验收:Dashboard 渲染统计卡 + 两图;主题切换/窗口 resize 正常;mock 数据处有明确 TODO;主包体积无明显增长;`pnpm verify` 全绿。

## 阶段 13:媒体资源分组(**已交付并验收**)

> **交付记录**:e2e 起的 server 需显式 `CSRF_ALLOWED_ORIGINS`(阶段 10 联带,同阶段 9);分组权限码按计划挂 `menu:media:image` 单菜单。

### 契约(admin.yaml,media tag;先改契约 → gen:api)

| 方法         | 路径                                 | 说明                                                |
| ------------ | ------------------------------------ | --------------------------------------------------- |
| GET / POST   | /api/admin/media-groups              | 分组列表(按 `kind` 过滤,含组内计数)/ 新建(409 重名) |
| PUT / DELETE | /api/admin/media-groups/{id}         | 重命名 / 删除(组内资源移回"未分组",不删资源)        |
| GET(改)      | /api/admin/images、/api/admin/videos | 增加查询参数 `groupId`(不传=全部,0=未分组)          |
| POST(改)     | /api/admin/images、/api/admin/videos | multipart 增加可选字段 `groupId`                    |
| PATCH        | /api/admin/images/{id}/group         | 移动图片分组(body `{groupId}`,0=移出)               |
| PATCH        | /api/admin/videos/{id}/group         | 移动视频分组                                        |

- `ImageAsset`/`VideoAsset` schema 增加 `groupId`(int64,0=未分组)与 `groupName`;
- 权限码:`media:group:list/create/update/delete`(挂 `menu:media:image`,授权树里"图片管理"下可见;分组为图片/视频共用能力,单菜单挂载是注册表单值字段下的取舍,注释说明);移动分组复用各 kind 的 `media:xxx:update` 码(不新增)。

### server

- `media_groups` 表(id, kind, name, created_at;`kind + name` 唯一);`media_assets` 增加 `group_id BIGINT NOT NULL DEFAULT 0`(AutoMigrate 加法变更,历史数据即"未分组");
- 分组列表带计数(LEFT JOIN COUNT);删除分组事务内将组内资源 `group_id` 置 0;
- oplog 埋点:`mediaGroup.create/update/delete`、`media.moveGroup`(description 写人话,如"移动图片 a.png 到分组 轮播图")。

### admin

- 图片/视频页改**双栏**:左侧分组栏(全部/未分组/各分组 + 计数,底部"新建分组",行内重命名/删除,`AuthGate media:group:*`);右侧内容区沿用查询 + 网格/表格 + 全量分页;
- 上传弹窗增加分组 `Select`;卡片/行操作增加"移动分组"(弹窗选目标分组)。

验收:建组→上传选组→按组筛选→移动→删组(资源回未分组)全流程可用;权限不足时分组管理按钮置灰、接口 403;操作日志出现分组相关人话条目;`pnpm verify` 全绿。

## 阶段 14:大文件分片上传(**已交付并验收**)

> **交付记录**:e2e 用 12MB 伪视频(3×5MB 分片)代替 30MB 真视频,服务端只校验扩展名与大小、不做内容解析,不影响断言强度;取消用例曾出现"并行必挂、单跑必过"的竞争——进度块在 preparing 态就渲染、init 返回后"暂停"按钮插入使"取消上传"右移,Playwright 按旧坐标点击落在"暂停"上,表现为取消未生效;修复为点击前先等"暂停"按钮可见(状态确定后再操作)。COS 原生 multipart / 前端直传仍为后续演进 TODO。

### 协议(契约新增 `uploads` tag;分片仅视频启用,图片 ≤10MB 维持单发)

| 方法   | 路径                                         | 说明                                                                                                             |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| POST   | /api/admin/uploads/images                    | 初始化图片上传会话 {fileName, size, groupId?} → {uploadId, chunkSize, chunkCount, uploadedIndexes}               |
| POST   | /api/admin/uploads/videos                    | 初始化视频上传会话(同构;**按 kind 拆两个端点是为了权限码静态绑定** `media:image:upload` / `media:video:upload`)  |
| PUT    | /api/admin/uploads/{uploadId}/chunks/{index} | 分片上传(octet-stream,服务端校验 index 范围与单片大小),204                                                       |
| GET    | /api/admin/uploads/{uploadId}                | 会话状态(已传分片索引,断点续传用)                                                                                |
| POST   | /api/admin/uploads/{uploadId}/complete       | 合并 → 走既有 media 上传管线(校验/存储/提取/落库/oplog)→ 返回精简 `UploadedMedia`{id, kind, url, origName, size} |
| DELETE | /api/admin/uploads/{uploadId}                | 中止并清理会话,204                                                                                               |

### server

- **会话存储用磁盘,不建表**:`data/uploads/{uploadId}/` 下 `meta.json`(kind/fileName/size/chunkSize/uploaderID/createdAt)+ 分片文件 `chunk-000001...`;自包含、免迁移,重启后 GET 仍可续传;
- 分片落盘走临时文件 + rename(并发安全);客户端并发 3-4 片上传;
- **属主校验**:chunk/complete/abort 校验 claims.UserID == meta.uploaderID,否则 404(不泄露会话存在性);权限校验集中在初始化端点(注册表静态绑定),后续分片操作仅要求登录 + 属主;
- **complete**:校验分片齐全与总大小 → `io.MultiReader` 顺序拼接 → 复用 `media.Upload` 管线(扩展名/大小校验、`storage.Save`、提取器、files/media_assets、oplog `media.upload`);
- **会话清理**:启动时 + 定时(每小时)删除超过 24h 的未完成会话(常量,后续需要再迁环境变量);
- **视频上限提升**:分片启用后视频上限提升至 2GB(常量),图片维持 10MB;
- **COS 说明**:本期分片在服务端落地,complete 后经 `storage.Save` 中转至对象存储——两种驱动一条代码路径;**COS 原生 multipart / 前端直传(presigned URL)列为后续演进 TODO**,不改 Storage 接口。

### admin

- `src/hooks/use-chunked-upload.ts`:初始化 → 并发(3)PUT 分片(单片失败自动重试)→ complete;暴露**总进度(已传字节/总字节)、暂停/继续、取消(abort)**;
- 断点续传:localStorage 按"文件指纹(fileName+size+lastModified)"记 uploadId,上传弹窗识别到未完成会话时提示"续传/重新上传";
- 视频上传弹窗改造:选文件 → 自动分片上传 → 进度条 + 暂停/取消,完成后刷新列表;上传可选分组(阶段 13 能力)。

### 测试与验收

- Go 单测:会话生命周期(初始化/分片校验/属主拒绝/complete 拼接正确性/清理);
- e2e:生成 ~30MB 文件走分片上传 → 列表可见、可播放;中途取消后会话清理、再传可续传;
- 冒烟:`driver=cos` 下分片 complete 后 CDN 字节一致;`pnpm verify` 全绿。

## 跨阶段约定

- **阶段 11 沉淀的 UI 规范对 12-14 生效**:Dashboard、媒体分组、上传弹窗的新页面/改造必须遵守 PageContainer、全量分页、菜单图标等规范;
- envelope 增加 `logID`、schema 增加字段均为加法变更,SQLite/MySQL 双端 AutoMigrate 安全,无破坏性迁移;
- `permission.go` 注册表每新增条目,启动时自动 upsert 进权限表并授予 super_admin,无需手工种子;
- 每阶段独立提交(Conventional Commits),阶段内先改契约的提交与实现提交分开,便于回溯。
