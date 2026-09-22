# 测试体系与 Site SSR 分阶段计划(阶段 15-19)

本计划承接 [admin-enhancement-plan.md](./admin-enhancement-plan.md)(阶段 9-14 已交付并验收),覆盖两批需求:**全仓测试体系**(admin 单元/组件测试 + 测试规范)与 **Site 对外网站工程**(Modern.js SSR 基座 + 质量/安全)。开发纪律不变:契约先行、生成物禁手改、每阶段 DoD 为 `pnpm verify` 全绿。

本计划同时示范新测试纪律的落地方式:**每个阶段的方案里直接给出测试用例清单与边界条件**(见各阶段"测试用例清单"小节),该要求自阶段 19 起写入规范对 AI 强制生效。

## 需求 → 阶段映射

| 需求(原始清单)                                              | 阶段  |
| ----------------------------------------------------------- | ----- |
| Admin 单元/组件测试(Vitest + React Testing Library)         | 15    |
| Admin E2E(Playwright,已有 3 条,保持并扩充断言)              | 15/16 |
| 开发规范:做计划时编写测试用例、定义边界条件                 | 15/19 |
| Admin UI:系统配置页布局(铺满或居中)                         | 16    |
| Admin UI:去掉内容区顶部标题(与面包屑重复)                   | 16    |
| Admin UI:公共 footer 版权标识                               | 16    |
| Site 技术栈/目录结构/依赖/开发规范(SSR + React19 + zustand) | 17    |
| Site 单元/组件测试(Vitest + RTL)与 E2E(Playwright)          | 18    |
| Site 接入阿里云 RUM 数据上报                                | 18    |
| Site XSS、CSRF 防御                                         | 18    |
| 仓库级测试编排与规范统一                                    | 19    |

## 阶段总览与三线并行

| 阶段 | 主题                         | 规模 | 前置 | 线  |
| ---- | ---------------------------- | ---- | ---- | --- |
| 15   | Admin 测试体系(Vitest + RTL) | M    | —    | A   |
| 16   | Admin UI 打磨(三处)          | S-M  | —    | C   |
| 17   | Site SSR 工程基座            | L    | —    | B   |
| 18   | Site 质量 + RUM + 安全       | M    | 17   | B   |
| 19   | 仓库级测试编排与规范统一     | S    | 16   | C   |

三 agent 并行分组(与文件归属配套,见文末"执行纪律"):

- **线 A(Admin 测试)**:阶段 15;完成后支援全仓 verify 与 e2e 补充;
- **线 B(Site 全线)**:阶段 17 → 18(串行,18 依赖 17 的应用骨架);
- **线 C(Admin UI + 规范编排)**:阶段 16 → 19(串行;16 不依赖 15,可立即开工;16 的组件测试用例随 15 的基座合入后补跑)。

## 阶段 15:Admin 测试体系(Vitest + React Testing Library;**已交付并验收**)

> **交付记录**:admin 接入 Vitest 5 + RTL 16(jsdom + `globals: true` + matchMedia/ResizeObserver 等 shims),test 脚本切 `vitest run`,smoke 5 条迁移保留,新增 62 条覆盖方案全部对象与六类边界(70/70 绿,typecheck/lint 绿)。偏差:React 19 的 async act 在作用域内含"永不 resolve 的在途分片"thenable 时会挂死,上传发起改同步 act + `waitFor` 轮询;RTL 自动 cleanup 依赖全局 afterEach,故 `globals` 必须开;`chunked-upload-resume` 的 localStorage 存取按边界要求补 try/catch(测试驱动的最小源码改动);AuthGate 的 Tooltip 弹层在 jsdom 不渲染,无权限断言按允许退化为 disabled 包裹语义;`tsconfig.json` include 补 tests 使 typecheck 覆盖测试代码。

### 方案

- **依赖**:`vitest`、`@testing-library/react`(v16,支持 React 19)、`@testing-library/user-event`、`@testing-library/jest-dom`、`jsdom`(peer 依赖 `@testing-library/dom` 一并安装);
- **配置**:`apps/admin/vitest.config.ts`(environment `jsdom` 全局——admin 用例以组件为主,纯逻辑用例用 `// @vitest-environment node` docblock 覆盖)+ `tests/setup.ts`(`import "@testing-library/jest-dom/vitest"`);
- **脚本**:`package.json` 的 `test` 从 `node --test tests/*.test.mjs` 改为 `vitest run`(turbo `test` 任务自动收纳,根命令零改动);既有 5 条 smoke 用例(源码断言,防 basename 类结构性回归)**整体迁移**到 vitest 保留价值,`node --test` 退役;
- **用例组织**:`apps/admin/tests/` 下 `*.test.ts(x)`,与页面/hook 对应命名;生成物(`src/api/generated/`)不写用例;
- **mock 边界**:统一在 `src/api/client.ts` / `controllers.gen` 层 mock(axios adapter 或 vi.mock Controller),禁止 mock 内部实现细节;`window.matchMedia` 等 jsdom 缺失 API 在 setup 补 shim;
- **测试规范落 `docs/admin.md` 新章节"测试"**:用例分层(纯函数/状态机 hook/组件交互 → Vitest;关键流程 → Playwright)、计划期用例纪律、边界条件清单要求(空值/零值/越界/权限缺失/网络失败/非法状态迁移六类必查)。

### 测试用例清单(含边界条件)

| 对象                        | 用例要点                                                                                                                                                                           | 边界条件                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `config/menu.tsx` 纯函数    | `filterMenusByPermissions`/`hasMenuPermission`/`matchMenuTrail` 全分支                                                                                                             | permissions 为 undefined/空数组;menu 码、模块码、api 前缀码三种命中;子项全不可见时目录消失;未知路径 trail 为空                 |
| `use-table-query`           | 初始 page=1;翻页;改 pageSize 重置回第 1 页;`resetPage`                                                                                                                             | total=0;删除末页最后一条后页码越界回退                                                                                         |
| `use-chunked-upload`        | 状态机 idle→preparing→uploading→completed;init 失败→failed;单片重试 2 次耗尽→failed;pause 中止在途;cancel 调 abortUpload 并清指纹;resume 对账合并 fresh 分片;complete 失败保留指纹 | 末片不足 chunkSize 的字节数折算;取消后代次失效(旧 complete 返回不得覆盖新状态);续传指纹 fileName+size+lastModified 命中/未命中 |
| `chunked-upload-resume`     | 指纹存取/清除                                                                                                                                                                      | localStorage 抛异常(隐私模式)不向上冒泡                                                                                        |
| `use-file-url`              | 记录带 url 直返 CDN;无 url 走 blob+Bearer                                                                                                                                          | 404 错误分支                                                                                                                   |
| `use-permission` + AuthGate | 命中渲染;未命中置灰+Tooltip;有操作权限                                                                                                                                             | permissions undefined(登录中态)                                                                                                |
| `error-boundary`            | 子组件渲染期 throw → fallback 卡片;reset 后恢复                                                                                                                                    | 事件回调内的 throw 不属于渲染期、不被捕获(用例固化该语义)                                                                      |
| `api/client.ts`             | envelope 解包;非 envelope 透传;错误读取 message;**logID 拼接**;401 清 token(非 login 请求);网络错误文案                                                                            | login 请求的 401 不清 token;envelope 缺 data 字段                                                                              |
| smoke(迁移)                 | 既有 5 条源码断言原样保留                                                                                                                                                          | —                                                                                                                              |

### 验收

`pnpm --filter @monorepo-template/admin test` 全绿且覆盖上表;既有 e2e 3 条不回归;`pnpm verify` 全绿;`docs/admin.md` 测试章节与 AGENTS.md admin 段测试规则(阶段 19 统一收口前先落 admin.md)。

## 阶段 16:Admin UI 打磨(配置页布局 · 去标题 · 公共 footer;**已交付并验收**)

> **交付记录**:PageContainer 移除 title 渲染(8 处使用点核实无一显式传 title);配置页 `.form-page` 720px 窄栏居中、吸底操作栏改容器内 sticky(`.page-extra` 独立后补间距与右对齐保持原视觉);AppFooter + `COPYRIGHT_TEXT` 常量(年份固定写入保证可测),登录页经守卫分支天然不渲染;e2e 补 `.page-title` count 0 与 footer 可见断言;5 条组件用例在线 A 基座合入后实跑通过。

### 方案

- **去掉内容区顶部标题**:`PageContainer` 移除 `title` prop 与 `h3.page-title` 渲染,保留面包屑与 `extra` 操作区(已核实所有页面均未显式传 title,标题全部来自面包屑叶子默认值,故只改组件一处 + 删 `.page-title` 样式);`docs/admin.md` UI 规范同步改口径:PageContainer = 面包屑 + 操作区,不再渲染标题;
- **系统配置页布局**:现状是 `Form maxWidth 640` 左对齐 + 底部操作栏负 margin 全宽吸底,视觉上"既没铺满也没居中"。改为**窄栏居中**范式(arco-pro form/group 风格):表单容器 `.form-page { max-width: 720px; margin: 0 auto; }`,吸底操作栏宽度跟随容器(去掉 `margin: 16px -24px -24px` 全宽负边距,改为容器内 sticky);该范式写入 `docs/admin.md` 作为分组表单页的标准布局——**列表/网格页保持铺满,表单页统一窄栏居中**;
- **公共 footer**:`src/components/app-footer.tsx` + `constants` 增加 `COPYRIGHT_TEXT`(占位 `© 2026 CMS Template`,TODO 标注替换真实主体);layout 在 `Content` 之后渲染(`ArcoLayout.Footer`),居中、次要文字色;登录页不渲染;
- e2e 补断言:业务页无 `.page-title`、footer 文案可见。

### 测试用例清单

| 对象          | 用例要点                               | 边界条件                      |
| ------------- | -------------------------------------- | ----------------------------- |
| PageContainer | 面包屑链正确;不渲染标题;extra 插槽渲染 | 404 路径(trail 空)不炸        |
| AppFooter     | 渲染 `©` + 年份 + 文案                 | 年份来自注入的固定 Date(可测) |
| 配置页布局    | 表单容器带居中类名;操作栏在容器内      | items 为空(配置组无键)不炸    |

> 组件用例依赖阶段 15 的 vitest 基座:若 15 未合入,先交付 UI 改动 + e2e 断言,组件用例在 15 合入后同日补齐(计划即约定此顺序)。

### 验收

全部业务页无重复标题;配置页窄栏居中且操作栏不再错位;footer 全业务页可见;`pnpm verify` 全绿。

## 阶段 17:Site SSR 工程基座(Modern.js SSR;**已交付并验收**)

> **交付记录**:SSR 验证证据——curl 首页 HTML 直接含站名与页头页脚(禁 JS e2e 同样断言);SSR 构建产出服务端 bundle。偏差:方案假设的 `useLoader` 是 Modern.js 2.x API,3.5 App Router 实际约定为 `src/routes/*.data.ts` 具名导出 `loader` + 组件 `useLoaderData`(已核类型与官方文档,并写入 docs/site.md);Arco 无公共 `useResponsive`(ahooks 的在 SSR 下返回 undefined 且共享模块态,不适合 hydration),自建 `hooks/use-breakpoint.ts`(SSR 固定按桌面渲染、挂载后同步,断点 768px 与 Arco Grid md 对齐);layout 与首页各拉一次 site-info,栏目页增多后可合并(已注明)。

### 技术决策

| 项           | 决策                                                                                                                 | 说明                                                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 框架         | Modern.js(appTools,App Router)+ `server: { ssr: true }`                                                              | 与 admin 同代同栈(3.5);SSR 开启后 `useLoader` 在服务端执行,数据随 HTML 下发,客户端 hydration 复用                                                                           |
| UI 库        | **Arco Design(`@arco-design/web-react`)**                                                                            | 与 admin 一致、规范已沉淀;响应式用 Arco Grid/`useResponsive` + 移动端抽屉导航。**待确认决策**:若站点的移动端体验要求超出 Web 组件能力,后续再评估 Arco Mobile,不影响本期基座 |
| 状态         | zustand(客户端全局状态,如移动端菜单开合 `useUiStore`)                                                                | 服务端数据(loader/site-info)不进 zustand,遵循"服务端状态走 loader"的分层                                                                                                    |
| 依赖         | `lodash-es`(ESM tree-shaking,按方法引入)、`ahooks`、`axios`                                                          | ahooks/useRequest 不用于站点数据请求,loader 为主                                                                                                                            |
| 端口         | dev `8082`(server 8080 / admin 8081 已占用);e2e `18081`                                                              | dev 代理 `/api` → `API_PROXY_TARGET`(默认 8080),与生产网关前缀规则一致                                                                                                      |
| SSR 请求地址 | `src/api/client.ts` 改造:服务端用绝对地址(env `SITE_API_BASE`,默认 `http://127.0.0.1:8080`),浏览器端空串同源相对路径 | SSR 进程内相对路径不可用,必须显式注入;dev 与生产各自注入                                                                                                                    |
| 目录结构     | `src/api`(client/generated/controllers)、`components`、`hooks`、`store`、`constants`、`config`、`utils`、`routes`    | 用户清单中 `const` 按仓库既有命名(admin/AGENTS.md 均为 `constants/`)落为 `constants/`,保持全仓一致                                                                          |
| 契约         | **零改动预期**:本期仅消费既有 `GET /api/site/site-info`                                                              | 站点内容类接口(文章等)待真实业务需求时另立阶段落 `openapi/site.yaml`                                                                                                        |

### 交付物

- `modern.config.ts`(appTools + ssr + port 8082 + dev proxy)、`package.json`(dev/build/serve/typecheck/lint 脚本,接入 turbo 与根 `pnpm dev`);
- `src/routes/layout.tsx` + `page.tsx`(首页)+ `$.tsx`(404):首页 `useLoader` 服务端拉 site-info 渲染站名/Logo,证明 SSR + 数据链路通;
- `src/components/site-header.tsx`(桌面导航 / 移动端汉堡抽屉,`useResponsive`)+ `site-footer.tsx`(版权,复用阶段 16 的文案常量约定);`src/store/ui.ts`(`useUiStore` 移动端菜单态);`constants/config/utils` 目录按归属说明建立(空目录以首件或 `.gitkeep` 占位,职责写进 docs/site.md);
- **`docs/site.md` 新建**(site 开发规范全集):目录结构、响应式适配要求(mobile + desktop 必须双端可用,断点约定)、复用规则(2 处以上用 → 抽公共)、拆分规则(单文件 ~300 行,主入口 + 模块)、**计划期测试用例纪律**、`dangerouslySetInnerHTML` 禁令、SSR 注意事项(`window`/`localStorage` 等仅客户端 API 必须守卫,loader 内不得引用客户端状态);
- `AGENTS.md` 追加 site 段(摘要 + 指向 docs/site.md)。

### 验收

`pnpm dev` 三端并起(server/admin/site);curl `localhost:8082` 首页 HTML 含站名(SSR 证据,不是客户端才渲染);手机视口 header 折叠为汉堡;`pnpm verify` 全绿。

## 阶段 18:Site 质量 + RUM + XSS/CSRF(**已交付并验收**)

> **交付记录**:vitest 26 条全绿(双端 baseURL/envelope/错误降级/ui store/响应式/RUM 守卫);根 playwright 增 site project + 第三 webServer(18081,SSR fetch 直连 SITE_API_BASE 须注入),5 条 e2e 全绿(禁 JS 含站名、双视口、dev 无 RUM 上报);RUM 走 npm `@arms/rum-browser@0.1.16` 无需 CDN 回退;生产构建验证 CSP meta 在位。**主 agent 集成期修复**:验证时发现浏览器端 `ReferenceError: process is not defined`——RUM 配置默认参数为裸 `process.env` 引用,rsbuild 仅内联成员访问;改为 `modern.config.ts` 的 `source.define` 把 `process.env.RUM_*` 构建期内联为字面量(未配置为空串,dev 默认关闭语义不变),RUM 变量自此须在构建(CI)阶段注入(见 docs/site.md「监控」)。

### 测试基座(与 15 同构)

- vitest + RTL + jsdom 同款配置(两 app 各持一份小配置,重复可接受;后续第三个 app 出现时再评估抽 `@repo/vitest-config`,本期不做);
- Playwright:根 `playwright.config.ts` 增 site project 与第三个 webServer(site e2e `PORT=18081 API_PROXY_TARGET=http://127.0.0.1:18085`,复用 e2e server)。

### 测试用例清单

| 对象         | 用例要点                                                                       | 边界条件                                 |
| ------------ | ------------------------------------------------------------------------------ | ---------------------------------------- |
| site client  | SSR 端绝对 baseURL(注入 SITE_API_BASE);浏览器端相对;envelope 解包;错误 console | 服务端请求失败(loader 内)不炸渲染        |
| `useUiStore` | 菜单开合 toggle                                                                | —                                        |
| site-header  | 桌口渲染导航;移动断点(mock `matchMedia`)渲染汉堡;抽屉开合                      | 断点临界值                               |
| RUM 初始化   | 无 env 不初始化;有 env 且 `window` 存在才初始化(SSR 守卫)                      | env 缺 endpoint 与 pid 任一项 → 不初始化 |
| e2e(SSR)     | `javaScriptEnabled: false` 下首页仍含站名(SSR 硬证据)                          | —                                        |
| e2e(响应式)  | 桌面/手机双视口冒烟(汉堡切换、布局不横向溢出)                                  | —                                        |
| e2e(RUM)     | dev 构建不注入 RUM script                                                      | —                                        |

### RUM 接入(阿里云用户体验监控)

- 包:`@arms/rum-browser`(ARMS 用户体验监控 RUM 的浏览器 SDK;npm 包文档尚薄,若与 SSR 构建冲突,回退方案为 CDN script `sdk.rum.aliyuncs.com/v2/browser-sdk.js` 注入);
- 初始化:**仅客户端**(`typeof window` 守卫,SSR 不执行)、**动态 import** 不阻塞首屏;配置来自 env `RUM_ENDPOINT`(必填)与 `RUM_PID`,任一缺失即不初始化——**dev 默认关闭**,生产部署注入(`apps/server/.env.example` 同款纪律,site 侧 `.env.example` 补占位);`spaMode: "history"`(SPA PV 上报),`version` 取应用版本;
- 上报内容:PV、JS 错误、Web 性能(SDK 默认采集),不做自定义埋点(待真实需求)。

### XSS / CSRF

- **XSS**:SSR 输出由 React 转义;`dangerouslySetInnerHTML` 禁令进 docs/site.md + AGENTS.md(富文本需求出现时先引 DOMPurify);外部/媒体 URL 渲染限定 `http(s)` 协议;生产构建注入 CSP meta(`modern.config.ts` html 配置,仅生产,与 admin 同策略)——**注意**:SSR 会内联 loader 数据脚本,严格 `script-src 'self'` 会拦内联 script,起步用 `script-src 'self' 'unsafe-inline'`,nonce 化列为 TODO;网关层 CSP 示例写入部署文档;
- **CSRF**:site 契约全部为 GET 公开只读、无 Cookie 无会话——结构性不适用(与 admin 的 Bearer 结论同理,写进 docs/site.md 与 server.md 交叉引用);**约束**:site 未来新增写接口时,必须在 site 链挂 `OriginCheck`(阶段 10 已有中间件,复用)且不得引入 Cookie 会话,二者缺一不得合并。

### 验收

上表用例全绿;`pnpm test`(含新增 site e2e)全绿;生产构建产物含 CSP meta 且 dev 不含 RUM。

## 阶段 19:仓库级测试编排与规范统一(**已交付并验收**)

> **交付记录**:docs/development.md 新增「测试体系」章节;AGENTS.md 追加第 17 条测试纪律(六类边界必查)与 site 段 18-21(与线 B 追加衔接完好);turbo.json / verify.sh 核对为零改动(结论与方案一致,site test 脚本由 turbo 自动收纳)。

- **`docs/development.md` 新增"测试体系"章节**:测试金字塔(纯函数/hooks 状态机/组件交互 → Vitest;关键用户流程 → Playwright;Go 侧 go test)、各端测试栈一览表(admin/site:Vitest+RTL+Playwright;server:go test;根级 jest 保留——它断言的是仓库结构与 CI 脚本,职责不同,不做合并)、**计划期用例纪律**(方案/计划必须先列用例清单与边界条件,实现提交与用例同批;六类边界必查:空值/零值/越界/权限缺失/网络失败/非法状态迁移);
- **`AGENTS.md` 收口**:通用硬规则追加"做计划时先写测试用例并定义边界条件,用例与实现同批交付";site 段核对齐全;
- **根编排核对**:`pnpm test` 在 admin/site 接入 vitest 后由 turbo 自动收纳(已核实 turbo `test` 任务存在,预计零改动,执行时验证并记录);`scripts/verify.sh`、CI 链路对 e2e 双 app 的影响核对(记录性工作);
- 验收:文档评审通过;`pnpm verify` 全绿;无遗留 TODO 未标注。

## 三 agent 并行执行纪律

| 线  | 阶段    | 文件归属(只动这些)                                                                                                                                                                                       |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | 15      | `apps/admin/{vitest.config.ts,tests/**,package.json(test 脚本与 devDeps),src/**(仅测试所需的最小导出调整)}`、`docs/admin.md`(测试章节)                                                                   |
| B   | 17 → 18 | `apps/site/**`、`docs/site.md`、`playwright.config.ts`(18 增 site project)、`tests/playwright/**`(site 用例)、`AGENTS.md`(仅追加 site 段)                                                                |
| C   | 16 → 19 | `apps/admin/src/{components,routes,constants}`、`apps/admin/tests/**`(16 的组件用例,协调见下)、`tests/playwright/**`(footer/标题断言)、`docs/admin.md`(UI 规范节)、`AGENTS.md`/`docs/development.md`(19) |

- **共享文件规则**:`docs/admin.md`(A 写测试节、C 写 UI 节,不同章节,Edit 按段落精确替换);`AGENTS.md` 只允许**尾部追加新段**,禁止重排既有内容;`apps/admin/tests/**` 归 A 独占,C 的 16 组件用例写在 `tests/ui/` 子目录并在 15 基座合入后再提交;提交一律按文件精确 `git add`,禁止 `git add -A`;
- **契约**:本批次预期零契约改动;任何线若发现必须改 `openapi/`,先停下在计划文档登记再动;
- **时序约定**:16 不依赖 15 可立即开工(只改组件/CSS/常量,不动 package.json);16 的组件用例补跑以 15 基座合入为前置;18 以 17 的应用骨架为前置;19 以 16 完成为前置(避免与 C 自身的 AGENTS.md/development.md 编辑交错);
- 每阶段独立提交(Conventional Commits),`pnpm verify` 绿后再合入下一阶段。

## 交付记录(2026-09-19,site 壳建设)

- 阶段 1-8 按 [docs/site-shell-plan.md](./site-shell-plan.md) 交付:依赖钉版与 transformImport(P1)、
  Arco CSS 按需收口 562→82 kB(P2)、zod env/特性开关/站点配置收口(P3)、tracking facade+
  web-vitals+CSP 联动(P4)、双层 ErrorBoundary/loading 骨架/client 韧性(P5)、覆盖率门禁与
  快照/a11y(P6)、AGENTS.md 与本文档收口(P7)、预算门禁进 CI 与总收口(P8);
- 编排与逐卡验收记录见 [docs/shell-exec-runbook.md](./shell-exec-runbook.md) 台账(site 行)。
