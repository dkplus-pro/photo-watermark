# AGENTS.md

本文件面向 AI 编码助手。人读的完整规范见 [docs/development.md](docs/development.md)。

## 项目是什么

pnpm + Turborepo monorepo,7 个应用(`apps/mobile` 为 Flutter 工程,不在 pnpm workspace):

- `apps/admin` — Modern.js + React 19 + Arco Design 的**纯静态「水印相框」批量导出工具**(无服务端、无登录,发布到 GitHub Pages,规范见 [apps/admin/AGENTS.md](apps/admin/AGENTS.md))
- `apps/server` — Go API 服务(admin/site/app/h5 四受众,见 multi-audience-contracts)
- `apps/site` — Modern.js SSR 对外网站(消费 `openapi/site.yaml`,规范见 [docs/site.md](docs/site.md))
- `apps/h5` — Modern.js SSR 活动 H5(匿名公开受众,消费 `openapi/h5/`,dev 端口 18082)
- `apps/desktop` — electron-vite + React 桌面端(匿名公开受众,消费 `openapi/app/`,dev 端口 18083)
- `apps/miniapp` — Taro 4 + React 微信小程序(匿名公开受众,消费 `openapi/app/`)
- `apps/mobile` — Flutter 手机端最小包(匿名公开受众,消费 `openapi/app/`,手写 http 调用;不在 pnpm workspace、禁止出现 package.json,平台目录需 `flutter create .` 补齐)

`openapi/` 目录是前后端唯一接口契约,按受众分 4 份:`admin.yaml` 供 server 的 gen/admin(消费端 `apps/admin` 已改为纯静态工具、脱离契约链,见规则 4-10),`site.yaml` 供 `apps/site` 与 server 的 gen/site,`app/` 与 `h5/` 两个多文件骨架目录供 mobile/desktop/miniapp 与 h5 及 server 的 gen/app、gen/h5;两侧代码均由对应契约生成。
当前按 [docs/mvp-plan.md](docs/mvp-plan.md) 分阶段交付管理后台 MVP,按 [docs/watermark-frame-plan.md](docs/watermark-frame-plan.md) 交付「水印相框」静态工具;新增功能先改 `openapi/` 下对应受众契约落契约,再写实现(admin 例外:它没有接口,新增能力 = 新增相框样式 + 清单条目)。

## 常用命令(仓库根执行)

- `pnpm dev` — 一条命令并行启动各前端 app 与 server(admin 是纯静态站,起它不需要 server)
- `pnpm gen:api` — 从 openapi/ 契约生成各 app 类型与 server 接口代码
- `pnpm lint` / `pnpm typecheck` / `pnpm test`
- `pnpm verify` — 提交前完整校验,改动后必须通过

## 硬性规则

### 接口契约

1. 接口改动先改 `openapi/` 下对应受众契约(admin 受众改 `admin.yaml`(现在只有 server 侧消费,`apps/admin` 已脱离契约链),site 改 `site.yaml`,C 端改 `app/`,H5 改 `h5/`),再 `pnpm gen:api`,然后补实现;
   1a. 契约共 4 份:`admin.yaml`、`site.yaml` 为单文件;`app/`、`h5/` 为多文件骨架目录(`openapi.yaml` 入口 + `paths/` + `components/schemas/`)。生成链差异:server 侧 oapi-codegen 不支持 schema 片段跨文件 `$ref`,app/h5 先经 `redocly bundle` 再生成(gen/app、gen/h5);JS 侧 orval 用 `input.parserOptions.externalRefs.allow: ["*"]` 直接解析多文件;
2. 生成物(各 app 的 `src/api/generated/`、`src/api/controllers.gen.ts`、`apps/server/gen/`)禁止手改;前端接口函数一律调用 orval 生成物,Controller 绑定层由 gen:api 从契约 tags 自动生成,不手写请求函数;横切逻辑(token/401/错误提示)只写在 `src/api/client.ts`(mutator 入口);`apps/admin` 无接口层,不参与本条;
3. 两侧不允许手写与契约重复的接口类型。

### admin =「水印相框」纯静态工具(详见 [apps/admin/AGENTS.md](apps/admin/AGENTS.md),方案见 [docs/watermark-frame-plan.md](docs/watermark-frame-plan.md))

4. UI 优先用 `@arco-design/web-react` 基础组件,不满足才自定义;主题走 `@arco-themes/react-juzi001/theme.css` 覆盖在 `arco.css` 之后引入,不做暗色模式;
   4a. **本 app 无服务端、无登录、无鉴权**:禁止出现 API 客户端、token 处理、`AuthGate`、TanStack Query / ahooks `useRequest`;唯一允许的 `fetch` 是同源取 `public/` 下的清单 JSON 与预设 logo 图;
5. 页面只剩两个:`/frames`(相框列表,网格一行 桌面 4 / 平板 3 / 手机单列,item 是缩略图卡片)与 `/frames/:styleId/export`(导出表单 + 实时预览)。左侧菜单只有「水印相框 → 相框列表」一项;菜单项必须带图标;新页面仍套 `PageContainer`(子路由用它的 `breadcrumb` prop 显式给尾项,因为 `matchMenuTrail` 走的是菜单声明);
   5a. **无列表分页/查询表单/增删改**这类后台范式,规则 5c/5d 的 arco-pro search-table 与分页要求不再适用;表单页按字段复杂度直接用 `Form` + `Card`,不需要吸底栏;
6. 目录分区:`src/utils`(`utils/frame/` 是渲染引擎,本 app 唯一的「业务内核」目录例外,允许放纯函数与 Worker)/ `components` / `hooks` / `routes`(页面)/ `store`(全局状态)/ `config` / `constants` / `types.ts`(运行时数据形状);
7. 复用规则:2 个及以上页面用 → 提到 `src/components`、`src/hooks`;单页面用 → 留在页面目录内;客户端全局状态 → zustand(`src/store/`,每个领域一个 `useXxxStore`),持久化只允许 `partialize` 白名单写用户偏好,禁止持久化 `File` 与进行中的任务状态;
8. **渲染纪律(硬性)**:批量渲染必须走 Web Worker 池(`src/utils/frame/worker-pool.ts`)且并发数由 `memoryAwareConcurrency()` 给出(禁止按 `hardwareConcurrency` 开并发)、canvas 面积上限靠探测;实时预览是唯一允许的主线程渲染(`utils/frame/preview-render.ts`,与导出共用内核,恒按长边 1200px);源图尺寸一律头部探测(`utils/frame/image-size-probe.ts`),禁止为拿宽高先解码全尺寸位图;相框样式的绘制走代码注册表(`style-registry.ts`),`public/frames.json` 只做清单;绘制几何一律纯比例,禁止 `clamp` 绝对像素;EXIF 继承必须零拷贝拼接(`piexifjs` 只碰 ≤256KB 头部,禁止把整幅图 latin1 字符串化);
9. 工具函数:通用 React 逻辑优先 ahooks(断点判定统一 `src/hooks/use-responsive.ts`),纯数据操作优先 lodash(按方法引入 `lodash/xxx`),两者覆盖不了才自写;静态资源引用一律经 `src/utils/asset-url.ts` 的 `assetUrl()`(Pages 子路径部署下硬编码 `/assets/...` 必 404);
10. 单文件超约 300 行必须拆分,页面主入口只做数据编排;构建产物只发布 admin 一个 app 到 GitHub Pages,`basePath` 必须同时喂 `output.assetPrefix`、路由 `basename` 与 `assetUrl` 三处(单一事实源见 apps/admin/AGENTS.md 第 10 节)。

### server(详见 [docs/server.md](docs/server.md))

11. 分层单向依赖:`handler → service → repo`;handler 薄、service 厚、repo 只管存取;
    11a. **日志双轨**:HTTP 访问日志只写 slog + 按天滚动文件(`logs/`,按 `ACCESS_LOG_RETAIN_DAYS` 清理),不入库、不查询;业务操作日志由 service 层在增删改与登录处显式埋点(`oplog.Record`,action 形如 `user.delete`,description 写人话,失败也记),查询接口只暴露业务日志;
    11b. 细化架构约束(依赖方向矩阵/受众接入/错误转译/事务/oplog/权限/测试纪律)见 [apps/server/AGENTS.md](apps/server/AGENTS.md);
12. `main.go` 只做装配;单文件超约 400 行按资源拆分;
13. handler 实现 oapi-codegen 生成的 `ServerInterface`,一个资源一个文件;
14. server 通过自身 `package.json` 的 `dev`/`gen:api` 脚本接入 turbo,保证根命令可用。

### 通用

15. 提交信息遵循 Conventional Commits;代码风格交给仓库 prettier/eslint/gofmt 配置,不自创风格;文件与符号命名必须语义化(按资源/领域),禁止 stage/temp/new/copy 等过程性命名;
16. 改代码前先查 `src/components`、`src/hooks`、`internal/` 是否已有可复用实现,先复用再新建;
17. 测试纪律:做计划时先写测试用例并定义边界条件(空值/零值/越界/权限缺失/网络失败/非法状态迁移六类必查),用例与实现同批交付;测试栈与编排详见 [docs/development.md](docs/development.md)「测试体系」。

### site(详见 [docs/site.md](docs/site.md))

18. site 是 Modern.js SSR 对外网站(appTools + `server.ssr: true`),只消费 `openapi/site.yaml` 公开契约,client 双端 baseURL:SSR 服务端用绝对地址(env `SITE_API_BASE`),浏览器端同源相对路径,环境判断统一 `typeof window === "undefined"`;
19. 服务端数据一律走路由 loader(`src/routes/*.data.ts` 具名导出 loader,组件用 `useLoaderData` 读取),loader 内禁止引用客户端状态、必须自捕获请求失败降级为 null;客户端全局状态用 zustand(`src/store/`),服务端数据不进 zustand,禁止 useEffect 手动拉接口;
20. 响应式双端适配是硬要求:每页在 mobile(< 768px)与 desktop 双端可用,断点判断统一走 `src/hooks/use-breakpoint.ts` 的 `useIsMobile()`(SSR 固定按桌面渲染,挂载后同步,保证 hydration 一致);
21. 禁止 `dangerouslySetInnerHTML`(富文本先过 DOMPurify);生产构建注入 CSP meta;RUM(`@arms/rum-browser`)仅客户端动态初始化,`RUM_ENDPOINT`/`RUM_PID` 任一缺失不初始化,dev 默认关闭。

### 新端(h5 / desktop / miniapp / mobile,方案见 [docs/monorepo-expansion-plan.md](docs/monorepo-expansion-plan.md))

22. 三个 JS 新端(h5/desktop/miniapp)统一目录与依赖:`src/` 下 `api/`(orval 生成物 + `client.ts` mutator + `controllers.gen.ts`)、`component/`、`config/`、`consts/`、`hooks/`、`store/`(zustand);统一依赖 `zustand`、`lodash-es`、`axios`、`ahooks`、`orval`;orval + controllers.gen 范式照 site(desktop 的 API 层在 `src/renderer/src/api/`;`apps/admin` 无接口层,不参与本条),生成物禁止手改(规则 2 同样适用);
    22a. h5 壳架构细化见 [apps/h5/AGENTS.md](apps/h5/AGENTS.md):core 分层与依赖方向、arco 按需纪律、SSR 安全(动态初始化+env 构建期内联)、监控埋点只经 `src/core/` 抽象、loader 降级契约;
23. h5/desktop/miniapp 均为匿名公开受众,边界与 site 一致(只读 + 网关放行前缀):`client.ts` 只做 `{code, message, data}` 信封解包与错误提示,禁止 token 注入与 401 跳转;契约已预留 `bearerAuth`,C 端用户体系落地前不实现鉴权逻辑;
24. miniapp 运行时无 XMLHttpRequest,网络层在 mutator 内直桥 `Taro.request`(即 `wx.request`;`axios-miniprogram-adapter` 与 axios 1.x 不兼容,已实测),只复用 axios 的 mutator 签名约定;`API_BASE_URL` 固定绝对地址,写在 `src/config/`;
25. mobile 为 Flutter 最小包:禁止出现 `package.json`;仓库只保留 `pubspec.yaml` + `lib/` + `test/`,平台目录(android/ios 等)不提交,首次在装有 Flutter SDK 的环境执行 `flutter create . --platforms=android,ios` 补齐;Android 模拟器内 `localhost` 指向模拟器自身,访问宿主机需用 `10.0.2.2`(详见 `apps/mobile/README.md`);
    25a. miniapp 壳架构细化见 [apps/miniapp/AGENTS.md](apps/miniapp/AGENTS.md):网络唯一入口、监控埋点只经 `src/core/`、配置只经 `src/config/` 环境表、core 零第三方运行时依赖、业务页面默认进分包,新增页面/埋点按其 checklist 执行。
