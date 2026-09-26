# apps/admin/AGENTS.md

本文件面向 AI 编码助手,是 `apps/admin`(「水印相框」纯静态批量导出工具,匿名公开受众,发布到 GitHub Pages)的架构约束规范。
根 [AGENTS.md](../../AGENTS.md) 的通用规则(15-17)与 arco 优先(规则 4)在此继续生效;**根规则 5-10 里属于 CMS 后台的条目(列表页 search-table 范式、PageContainer 面包屑规范、分页全量、TanStack Query、orval 契约链、AuthGate)对本 app 不再适用,以本文件为准**。
总体方案与分阶段交付记录见 [docs/watermark-frame-plan.md](../../docs/watermark-frame-plan.md);人读的操作性指南(目录、导出链路图、资源替换、发布)见 [docs/admin.md](../../docs/admin.md)。
违反本文件的分层与依赖方向修改会被评审与测试守卫拦截。

## 1. 分层与依赖方向

```
src/
  utils/frame/  # 渲染引擎(纯函数 + Worker,本 app 的核心资产,见第 4 节)
  utils/        # 公共纯函数:asset-url / catalog / download / file-name
  components/   # 公共组件(PageContainer / AppFooter / ErrorBoundary / NotFound)
  config/       # 菜单声明等壳层配置(无主题常量散落)
  constants/    # 常量:SYSTEM_NAME / APP_BASENAME / 断点 / 清单路径
  hooks/        # 跨页面复用的组合式逻辑(use-responsive / use-object-url / use-frame-catalog)
  store/        # zustand 领域 store(export / frame-catalog / ui),一个领域一个文件
  routes/       # Modern.js 约定路由:页面只做数据编排与布局,不写渲染逻辑
  types.ts      # 运行时数据形状(JSON 清单等),与 utils/frame/types.ts 的渲染契约分层互不 import
public/         # 静态资源:清单 JSON、缩略图、logo、webfont,全部经 assetUrl() 引用
```

**依赖方向硬规则**:

- `routes → {components, hooks, store, utils, config, constants}`;
- `utils/frame/**` 对外只允许 import 同目录模块与 `constants` / `utils/asset-url` / `utils/file-name`(纯命名工具),以及字节处理类三方库(`exifr` / `piexifjs` / `fflate`,只在主线程侧的 exif/fields/zip-writer 等处出现);禁止 import `store` / `routes` / `hooks` / arco / react(Worker 侧模块要能在 Worker 与 node 单测里独立运行);
- `utils/frame/types.ts` 是渲染契约唯一事实源,**冻结后不得随意改形状**(新增字段可以,改签名要同步全部实现并经评审);
- `store/**` 不得 import `utils/frame/export-pipeline`(流水线由页面编排,store 只记录状态);
- 页面与组件禁止裸触碰 `URL.createObjectURL`、`fetch`、`new Worker`,收口位置:`utils/download.ts` + `hooks/use-object-url.ts`(Blob URL)、`utils/catalog.ts` + 导出页 `logo-settings.ts`(同源 fetch)、`utils/frame/worker-pool.ts`(Worker);

## 2. arco 与主题

- UI 一律优先 `@arco-design/web-react` 基础组件(Card/Form/Select/Modal/Progress/Empty 等),确实不满足再自定义;
- React 19 下 **`src/routes/layout.tsx` 文件顶部必须** `import "@arco-design/web-react/es/_util/react-19-adapter"`(只允许注释行在它之前),否则 `Message`/`Notification` 走已移除的 `ReactDOM.render` 直接崩;
- 样式引入顺序固定:`@arco-design/web-react/dist/css/arco.css` → `@arco-themes/react-juzi001/theme.css`(芥子主题覆盖层,含 Inter 字体族声明与 `--color-*` 变量) → `src/routes/index.css`;顺序颠倒会让主题失效;
- 不做暗色模式:不引入 `arco-theme="dark"` 分支、不在组件里写死色值,颜色一律取 Arco CSS 变量;
- 移动端像素适配交给 CSS(媒体查询 + 相对单位),不引入 postcss vw 方案。

## 3. 静态化纪律(本 app 的存在前提)

- **无服务端**:不引入任何 API 客户端、不出现 `axios`/`fetch(远程)`/`token`/`401` 处理,`openapi/` 契约链与本 app 无关(`gen:api` 已移除);
- **无鉴权**:没有登录页、没有权限码、没有 `AuthGate`,全站匿名可用;
- **无服务端状态**:不引入 TanStack Query / useRequest。运行期需要的数据只有两类:① `public/` 下的静态清单(经 `store/frame-catalog` 一次性装载并缓存),② 用户本地选择的 `File`;
- 唯一允许的 `fetch` 是同源取 `public/` 下的资源:清单 JSON(`utils/catalog.ts` 经 `assetUrl(FRAMES_CATALOG_PATH)` / `assetUrl(LOGOS_CATALOG_PATH)`)与预设 logo 图(导出页 `routes/frames/[styleId]/export/logo-settings.ts`,失败降级为文字块不整页失败),生产 CSP 的 `connect-src 'self'` 会拦掉其他任何出网请求;
- 用户数据不出机器:图片字节、EXIF、logo 全部留在本地,产物只有用户主动下载的那个 zip。

## 4. 渲染引擎纪律

- 相框样式的**绘制实现走代码分支**(`utils/frame/style-registry.ts` 的 `styleId → FrameStyleDefinition`),`public/frames.json` 只做清单(id/name/thumbnail/sortOrder)。新增样式必须同时改两处,`utils/catalog.ts` 的守卫会让「清单里有、注册表没有」在装载期直接报错,不允许静默回落;
- 绘制函数必须是**纯函数**:只吃 `CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D` + 尺寸 + `ImageBitmap` + `FrameFields`,不 fetch、不碰 DOM、不读全局;
- **几何一律纯比例**(决策 D4):不允许出现 `clamp(x, min, max)` 式的绝对像素下限/上限。唯一例外是分隔线线宽 `Math.max(1, width * 0.0012)`(低于 1px 会消失)。这条是「300px 缩略图与 6000px 原图观感一致」的硬保证,新增几何量必须写成系数并在 `FRAME_GEOMETRY` 里登记;
- 输出尺寸由 `resolveOutputSize(源宽, 源高, 档位, maxCanvasArea)` 决定,**只缩不放**(决策 D3:原图档 ≤24MP、中档 12MP、小档 3MP,JPEG 质量恒 0.92);
- 文案口径只在 `utils/frame/fields.ts` 的 `frameFieldsFromExif` 里定义,页面与绘制端不得各自拼 EXIF 字符串;
- 实时预览固定按长边 1200px 渲染(决策 D18),与用户选的档位无关——预览是排版判断,不是成品;预览与导出**共用 `render-core` 内核**,参数策略的差异(长边 1200、质量 0.85、不继承 EXIF、恒走主线程画布)全部集中在 `utils/frame/preview-render.ts`,组件(`frame-preview`)只决定「什么时候画」;
- 「不解码只读尺寸」是导出与预览共同的前置(`resolveOutputSize` 要先于派发):源图尺寸一律经 `utils/frame/image-size-probe.ts` 从文件头段读(JPEG SOF / PNG IHDR / WebP),读不出来才允许退一次全尺寸解码(HEIC/AVIF 等),绝不「先解码拿宽高」(决策 D20 的 96MB 事故源);

## 5. Worker 与内存纪律

- 渲染并行**必须**走 `utils/frame/worker-pool.ts`,主线程只在 `supportsWorkerRendering()` 为 false 时降级串行(降级路径必须存在且被测试覆盖);
- 并发数由 `memoryAwareConcurrency(输出宽, 输出高, 任务数)` 给出,**不允许**直接用 `navigator.hardwareConcurrency` 决定并发:一个 24MP 任务在途约 192MB,按核数开机会在移动端被系统杀页;
- canvas 面积上限靠 `probeMaxCanvasArea()` **探测**(iOS Safari/安卓 WebView 有硬上限,超限静默产出空白图),探测结果全局 memoize;
- **解码期缩放**:一律 `createImageBitmap(file, { resizeWidth, resizeHeight, resizeQuality: "high" })`,绝不先解原图全尺寸位图再缩(决策 D20)。不支持该选项时退回全尺寸解码 + 逐级减半 `drawImage`,回退路径要有用例;
- **列表缩略图不许直显原图**:「照片」卡片的网格一律用 `utils/frame/thumbnail.ts` 在准备阶段产的小图(`ExportFileEntry.thumb`,运行时字段不进持久化),object URL 直指原图会让浏览器为一格 ~100px 的缩略位解码并缓存整幅位图,一次多选就把主线程顶住;缩略图产不出(探测失败/HEIC)才退回原图;
- EXIF 继承走零拷贝拼接(决策 D8):`piexifjs` 只允许碰 ≤256KB 的头部字节,整幅 JPEG 必须用 `Blob` 分段拼接交给浏览器落盘。**禁止**任何把整幅图像 `arrayBuffer()` 后转成 latin1 字符串的写法(那是参考实现里 10MB → 4-6 倍内存放大的事故源头);
- zip 用 `fflate` 的 `Zip` + `ZipPassThrough`(STORE,不二次压缩已经 JPEG 编码的字节),产物按 Blob 分片累积后一次 anchor 下载(决策 D5:移动端逐张下载不可用,已否决)。

## 6. 数据流与状态

- 客户端全局状态一律 zustand(`src/store/`),每个领域一个文件一个 `useXxxStore`;组件内按需订阅,组件外用 `getState()`/`setState()`;
- 需要跨会话保留的只有用户偏好(壳层折叠态、输出档位、logo 选择),用 `persist` + `partialize` **白名单持久化**;`File`、渲染进度、`status` 一律不许持久化(localStorage 存不下 File,持久化状态机会留下「刷新后仍在导出」的僵尸态);
- 服务端数据概念在本 app 不存在;表单提交(开始导出)是用户动作 + 长任务,不是数据请求,因此不得引入任何请求库来「管理」它;
- 一次性副作用(全局错误监听、Worker 创建/销毁)只在壳层与导出流水线内部装配,页面不得自行 `addEventListener` 全局捕获。

## 7. 移动端与响应式

- 断点判定统一走 `src/hooks/use-responsive.ts` 的 `useIsMobile()` / `useIsTablet()`(基于 ahooks `useResponsive`,注意它的语义是 **min-width**:`info[key] = innerWidth >= value`),禁止在组件里裸读 `window.innerWidth`;
- **整壳适配**(决策 D12):<768px 时侧边栏 `Sider` 不渲染,同一份菜单树渲染进 `Drawer`(`placement="left"`),不允许两份菜单实例并存(选中态与展开态会分裂);纯视觉差异用 `@media`,交互差异才用 hook;
- 相框列表列数:桌面 4 / 平板 3 / 手机单列;
- 移动端批量张数 >20 时给一条软提示(内存与耗时预期,表单页与进度弹框各一处),**不阻断**(决策 D19);
- 触摸目标 ≥44px,弹框在窄屏全宽,禁止用桌面才成立的 hover 承载唯一操作入口。

## 8. 测试纪律

- 栈:Vitest + React Testing Library(jsdom),配置在 `vitest.config.ts`(其中 `define.__APP_BASE_PATH__` 与 `modern.config.ts` 的 `source.define` **必须同值**,缺了会让任何 import `constants` 的用例 `ReferenceError`);用例放 `apps/admin/tests/**`,与源码目录一一对应;
- 渲染引擎的断言方式是**记录绘制指令、断言坐标**,不做像素对比(canvas 在 jsdom 里不可用,像素对比还得引 node-canvas,且抗锯齿差异会让用例天天红);
- 六类边界必查:空值、零值、越界、权限缺失(本站无鉴权可注明不适用)、网络失败(清单装载与解码失败是真路径,必须有)、非法状态迁移(store 状态机与「重复点导出」「取消后回报」是真路径);命中即必须有用例,用例与实现同批交付;
- mock 只打在模块边界(`controllers` 概念的替代物:`utils/asset-url`、`URL.createObjectURL`、`fetch`、`Worker`),禁止为通过测试而 mock 被测函数的内部实现;
- `tests/setup.ts` 统一补 jsdom 缺失的浏览器 API shim,用例内不散补;
- e2e:根 playwright 的 `admin` project 已配好(admin 起在 127.0.0.1:18080),黄金路径用例「选图 → 导出 → 拿到 zip」规划为 `tests/playwright/watermark-frame.spec.ts`(桌面 + 移动视口各一轮,**尚未补写,见方案阶段 15**),不为每个组件写 e2e。

## 9. 文件纪律

- **生成物已消失**:本 app 不再有 `src/api/generated/**`、`controllers.gen.ts`、`orval.config.ts`,`.prettierignore` 与 `pnpm-gen-api` 漂移检查都不覆盖 admin;新增接口这一动作在本 app 不存在,新增的是样式与清单条目;
- 单文件超约 300 行必须拆分,页面主入口只做数据编排;**这条对 `src/**` 与 `tests/**` 同等生效**:测试按「与被测模块一一对应」拆文件,共享夹具/替身抽进非 `*.test.ts` 的脚手架文件(`tests/utils/frame/export-test-harness.ts` 是范例,它不匹配 `vitest.config.ts` 的 include 所以不会被收集);注意 `vi.mock` 受提升语义限制必须写在测试文件内,所以脚手架只放数据与替身对象,mock 形状由各测试文件用 4 行指向它;
- 测试文件的豁免:**只覆盖单个模块**(页面装配用例只覆盖本页与只服务于本页的编排文件也算)且拆分会割裂同一上下文的——现存 4 个:render-core.test.ts 515 行、worker-pool.test.ts 471 行、routes/frames/export/page.test.tsx 805 行、store/export.test.ts 533 行,保留原文件并在文件头注释写明覆盖范围与不拆的理由;一个文件覆盖两个及以上**独立**被测模块就必须按模块拆开,不接受这个理由;
- `tsconfig.json` 的 `include` 覆盖 `tests/**`(即 `pnpm typecheck` 连用例一起查):没进类型检查的测试会静积累假绿——替身 `vi.fn(async () => …)` 把参数元组推成 `[]`、夹具漏传契约必填字段,运行时全绿、类型层全错。模块边界替身一律按契约类型参数化(`vi.fn<RunFrameExport>(…)`)而不是靠调用处 `as` 硬转;
- 静态资源引用**一律经 `assetUrl(path)`**:appTools 把 `public/` 内容拷进 `dist/public/` 并以 `<basePath>/public/<路径>` 对外提供,任何绕过 `assetUrl` 的硬编码(`/frames.json`、`/assets/...`、根部署下的 `/photo-watermark/frames.json`)都必然 404;
- 前提是 `modern.config.ts` 的 `server.publicDir: "public"` 还在:**appTools 默认只拷 `<source.configDir>/public`(即 `config/public`)**,本 app 没有 `config/` 目录,漏写这一行就整目录不随包,首屏直接报「相框清单内容非法」;`tests/smoke.test.ts` 已把这两点做成结构断言;
- `public/` 下的清单与 logo 是「给用户替换」的口子,新增项必须同时在 `public/README.md` 里说明改法;
- 命名语义化(按资源/领域),禁止 `stage` / `temp` / `new` / `copy` 等过程性命名。

## 10. 构建与发布

- **basePath 单一事实源**(决策 D11):`modern.config.ts` 里一个 `basePath` 变量同时产出 `output.assetPrefix`(带尾斜杠)与 `source.define.__APP_BASE_PATH__`(不带),`src/constants.APP_BASENAME` 消费后者,`src/modern.runtime.ts` 用它做 router basename。任何「把两处分别写一遍」的改法都是白屏事故的源头;
- 优先级:`GITHUB_PAGES_BASE_PATH` > Actions 仓库名推断 > `ADMIN_BASE_PATH` > `/`;
- 生产 CSP meta 必含 `img-src 'self' data: blob:`(预览与产物都走 Blob URL)、`font-src 'self'`(webfont 已本地化)、`connect-src 'self'`;
- CSP 的 `script-src` 必须是 `'self' 'unsafe-inline'`:Modern.js 把路由清单以**内联脚本**写进 `index.html`(`window._MODERNJS_ROUTE_MANIFEST = …`),只放行同源外链脚本会把它拦掉,**整站白屏**(已实测);清单内容含每次构建变化的 chunk hash,也无法预置 `sha256`。Pages 不发响应头,meta 是唯一 CSP 通道,所以这条约束只能落在策略本身;
- Pages 无 rewrite 能力:`scripts/deploy-github-pages.sh` 会把 `dist/index.html` 复制成 `dist/404.html`,让深链刷新由 SPA 接管(状态码仍是 404,但资源前缀是绝对路径,页面能渲染);
- 只发布 admin 一个 app(决策 D1):`.github/workflows/pages.yml` 的构建范围固定为 `@monorepo-template/admin`,其余 6 个 app 与 Go 服务不在发布链上;
- 提交前 `pnpm verify` 必须绿;`pnpm gen:api && pnpm format:write && git diff --exit-code` 这条漂移检查会真实重排 markdown 表格,**文档类改动同批要跑 `pnpm format:write`**。

## 11. 交付检查清单(新增能力时逐条走)

新增一个相框样式:

1. `src/utils/frame/frame-drawing.ts` 或新文件里写 `drawFrameComposition` 同签名实现(纯比例、无 clamp);
2. `src/utils/frame/style-registry.ts` 注册 `styleId`;
3. `public/frames.json` 加一条(`id` 与注册表一致、`thumbnail` 指向 `public/assets/thumbs/` 下真实文件);
4. 绘制指令单测(空字段 / 极小画布 / 超长文案截断)同批交付;
5. `pnpm --filter @monorepo-template/admin test` 里「仓库自带清单自检」用例必须绿(它会把 JSON 里的 id 与注册表、资源文件存在性对上)。

新增一个 logo 预设:只改 `public/assets/logos/` + `public/logos.json`(含 `mark` 文字兜底)+ `public/README.md`,代码零改动。

新增页面:`src/routes/**` 约定式路由 + `src/config/menu.tsx` 声明(菜单项必须带图标)+ `PageContainer` 套壳(子路由用 `breadcrumb` prop 显式给尾项)。

新增动态段路由:目录名只能用方括号 `[param]`(Modern.js 3 的 `nestedRoutes` 只做 `[x] → :x` 转换),**不能用 `$param`** —— `$` 前缀在这里不是动态段,`src/routes/frames/$styleId/` 会被当成字面量目录,生成的路由 path 仍是 `frames/$styleId/export`,于是 `/frames/plain-frame/export` 落到 `*` 兜底页(单测照样全绿,因为用例直接给组件传 props,不过路由)。
