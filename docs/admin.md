# admin(水印相框)开发指南

`apps/admin` 是一个**完全静态、无服务端**的「水印相框」批量导出工具:用户在浏览器里选一批本地照片 + 一个 logo + 输出档位,前端用 Web Worker 并行渲染带相框与 EXIF 文字的 JPEG,继承源图 EXIF,打成一个 zip 下载。全程不上传任何图片数据,部署目标是 GitHub Pages。

技术栈:Modern.js(appTools,SPA)+ React 19 + TypeScript + Arco Design(芥子主题 3279)+ zustand + ahooks + lodash + Web Worker/OffscreenCanvas + exifr/piexifjs/fflate。

约束规范(AI 与人共用)见 [../apps/admin/AGENTS.md](../apps/admin/AGENTS.md);方案与决策记录见 [watermark-frame-plan.md](watermark-frame-plan.md)。本文档是**人读的操作性指南**。

## 目录结构

```text
apps/admin/
  public/                 静态资源(清单 JSON + 缩略图 + logo + webfont),全部经 assetUrl() 引用
    frames.json           相框样式清单(id 必须能在 style-registry 里查到)
    logos.json            logo 预设清单(mark 字段是文字兜底)
    assets/{brand,logos,thumbs}/
    fonts/                Jost / Fira Sans 的 woff2 子集(Worker 内用 FontFace 加载)
  src/
    utils/frame/          渲染引擎(本 app 的核心资产,禁止 import React/arco/store)
      types.ts            渲染契约唯一事实源(冻结)
      frame-drawing.ts    相框绘制(纯比例几何,无 clamp)
      style-registry.ts   styleId → 绘制实现 的代码注册表
      fonts.ts            字体清单与 FontFace 加载(主线程/Worker 双端)
      exif.ts             EXIF 读取与零拷贝 APP1 注入
      fields.ts           exifr 解析 → 相框文案
      capability.ts       canvas 面积探测 / 输出尺寸 / 内存感知并发 / 特性检测
      image-size-probe.ts 不解码的源图尺寸探测(读 JPEG/PNG/WebP 头部;读不出才退全尺寸解码一次)
      render-core.ts      单张渲染内核(Worker 与主线程降级共用)
      frame.worker.ts     Worker 侧渲染入口
      worker-pool.ts      Worker 池(派发/取消/空闲回收)
      preview-render.ts   实时预览参数策略(长边 1200 / 质量 0.85 / 不继承 EXIF / 主线程,与导出同一内核)
      export-pipeline.ts  流水线门面(页面唯一入口),实现拆为四块:
                          export-jobs(备任务) / export-batch(批次编排与降级) /
                          export-cancel(取消令牌) / zip-writer(fflate 流式 STORE 打包)
    utils/                asset-url.ts / catalog.ts / download.ts / file-name.ts
    components/           PageContainer / AppFooter / ErrorBoundary / NotFound
    config/menu.tsx       侧边栏菜单声明(静态,无权限过滤)
    constants/            SYSTEM_NAME / APP_BASENAME / 断点 / 清单路径
    hooks/                use-responsive / use-object-url / use-frame-catalog
    store/                zustand:ui / export / frame-catalog(一个领域一个文件)
    routes/               约定式路由:layout.tsx(壳)、page.tsx(`/` 重定向 /frames)、$.tsx(404 兜底)、
                          frames/page.tsx(列表)、frames/[styleId]/export/page.tsx(导出表单页)
      导出页页面内模块:   components/{image-picker,size-tier-picker,logo-picker,frame-preview,
                          export-progress-modal}.tsx + use-export-flow.ts(导出编排)
                          + use-file-preparation.ts(入队图片探尺寸/读 EXIF)+ style-guard.ts(地址守卫)
                          + logo-settings.ts(logo 三态 → 渲染入参,预设图同源取回)
    types.ts              清单数据的运行时形状
  tests/                  Vitest 用例,目录与 src 一一对应
```

命名:组件文件 PascalCase 之外一律 kebab-case;hooks 以 `use` 开头;常量 SCREAMING_SNAKE;禁止 `temp`/`new`/`stage`/`copy` 这类过程性命名。

## UI 规范

- **组件优先级**:Arco Design 基础组件优先(`Card`/`Form`/`Select`/`Upload`/`Modal`/`Progress`/`Empty`/`Grid`),确实不满足再自定义;
- **主题**:`arco.css` → `@arco-themes/react-juzi001/theme.css` → `src/routes/index.css`,顺序不可颠倒;颜色一律取 Arco CSS 变量,不写死色值;**不做暗色模式**;
- **React 19 前置**:`src/routes/layout.tsx` 文件顶部(只允许注释行在前)必须 `import "@arco-design/web-react/es/_util/react-19-adapter"`,否则 `Message`/`Notification` 直接崩;
- **无后台范式**:本站没有列表分页、查询表单、增删改与权限按钮,不要再引入 `AuthGate`/`use-table-query` 那套;
- **移动端是一等公民**(< 768px):
  - 侧边栏 `Sider` 换成 `Drawer`(同一份菜单渲染,不留两份实例);
  - 相框列表一行 桌面 4 / 平板 3 / 手机 2;
  - 断点判定统一 `src/hooks/use-responsive.ts`(注意 ahooks `useResponsive` 的语义是 min-width),禁止裸读 `window.innerWidth`;
  - 触摸目标 ≥44px、弹框窄屏全宽、唯一操作入口不能只靠 hover;
  - 移动端批量 >20 张时给一条内存/耗时软提示(表单页与进度弹框各一处),不阻断。

## 状态管理

- 客户端全局状态一律 **zustand**,一个领域一个 `useXxxStore`:
  - `useUiStore`:壳层折叠态、移动端抽屉开关;
  - `useFrameCatalogStore`:`public/` 清单的装载与缓存(状态机 `idle → loading → ready | error`,失败可重试,in-flight 去重);
  - `useExportStore`:导出表单与长任务进度(文件列表、档位、logo、`done/total/failures`);
- 只有**用户偏好**跨会话:`persist` + `partialize` 白名单(折叠态、档位、logoId)。`File`、渲染进度、`status` 一律不持久化;
- 本站**没有服务端状态**概念:不装 TanStack Query、不用 ahooks `useRequest`、没有 API 层。页面提交导出是「用户动作 + 长任务」,由页面编排流水线、store 只记录结果;
- 可复用逻辑抽成 hooks 放 `src/hooks/`,纯函数放 `src/utils/`。

## 工具库

- 通用 React 逻辑优先 **ahooks**(`useResponsive`/`useMemoizedFn`/`useMount`/`useUnmount`/`useBoolean`/`useLocalStorageState`/`useDebounceFn`);
- 纯数据/集合操作优先 **lodash**,按方法引入:`import groupBy from "lodash/groupBy"`;
- 两者覆盖不了才自写;
- **Blob URL / fetch / Worker 三件事不允许在页面与组件里裸调**,收口位置固定:Blob URL → `utils/download.ts`(下载)+ `hooks/use-object-url.ts`(展示期生命周期);同源 fetch → `utils/catalog.ts`(清单 JSON)+ 导出页 `logo-settings.ts`(预设 logo 图,失败降级为文字块);Worker → `utils/frame/worker-pool.ts`。

## 导出链路(读代码前先看这张图)

```text
用户在表单页选图 + 选 logo + 选档位
        │  (入队即由 use-file-preparation 预探,展示与预览都吃现成结果)
        ├─ probeSizeFromHead(file)     只读头部段 → 源图尺寸(不解码,D20)
        ├─ extractPhotoExif(file)      exifr 动态加载 → PhotoExif
        ├─ frameFieldsFromExif(exif)   → 相框文案(FrameFields)
        └─ readHeadBytes(file)         只读前 256KB → 源图 APP1
                    │
   probeMaxCanvasArea()(全局一次) + resolveOutputSize(源尺寸, 档位, maxArea)
                    │
   memoryAwareConcurrency(输出宽, 输出高, 任务数) → 并发数(≤4,移动端预算 128MB)
                    │
        FrameWorkerPool ── postMessage(FrameRenderRequest) ──► Worker
                                        │  loadFrameFonts(FontFace)
                                        │  createImageBitmap(blob, {resizeWidth/Height})  ← 解码期缩放,不解全尺寸
                                        │  OffscreenCanvas + drawFrameComposition(styleId)
                                        │  convertToBlob({type:"image/jpeg", quality:0.92})
                                        │  spliceExifIntoJpeg(Blob 三段拼接,零拷贝)
        ◄── FrameWorkerResult ──────────┘
                    │
   fflate Zip(STORE) 边渲染边写入 parts: Blob[]  →  最终 new Blob(parts)
                    │
   downloadBlob(zip, "frame-export-YYYY-MM-DD.zip")  ← anchor + 30s 后 revoke
```

要点:

- **只缩不放**:三档「输出尺寸」是原图(≤24MP)/ 中(12MP)/ 小(3MP),JPEG 质量恒 0.92。源图小于档位上限时按原尺寸输出;
- **EXIF 完整继承**:源图 APP1 原样搬,只改 `Orientation → 1`(像素已在解码期转正)与 `PixelX/YDimension → 输出尺寸`。绝不允许把整幅 JPEG 转成 latin1 字符串(piexifjs 的接口是字符串,参考实现因此把 10MB 文件放大成 4-6 倍内存);
- **不支持 Worker 的浏览器**降级主线程串行渲染(`supportsWorkerRendering()` 为 false 时),功能不减、速度变慢;
- **zip 用 STORE 不压缩**:JPEG 已经压过,二次压缩耗时不讨好。
- **实时预览与导出同源不同策**:`frame-preview`(防抖 300ms + 请求序号防竞态)调 `utils/frame/preview-render.ts` —— 同一个 `render-core` 内核,但恒按长边 1200px、质量 0.85、不继承 EXIF、走主线程画布(D18);旧预览 URL 由 `use-object-url` 在换图/卸载时回收,组件内不写任何 revoke(D22);
- **logo 三态**(导出页 `logo-settings.ts`):无 logo → `mark` 为空;预设 → 清单 `source` 同源取回(会话内缓存,取不到降级画 `mark` 文字块);自定义 → 用户上传的 File(0 字节必须挡在入口,否则会波及整批失败);
- **`src/utils/download.ts` 的两条时序守卫**:anchor 必须先 `appendChild` 进文档再 `click`(Firefox 对游离节点根本不触发下载),`click` 后移除节点;object URL 一律经 `revokeObjectUrlLater(url, delayMs = 30_000)` 延迟回收,**默认值不许改成 0、也不许就地 revoke**(Firefox/Safari 在几百 MB 的 zip 上会断流或落 0 字节)。`document.body` 缺失时退回 `documentElement`,仍挂不上就静默返回 —— 下载结果由页面文案兜底,工具层不抛错。两条守卫分别对应 `tests/utils/download.test.ts` 的「硬规则 1 / 硬规则 2」用例。
- **命名口径集中在 `src/utils/file-name.ts`**,页面与流水线都不自己拼文件名:`sanitizeBaseName`(剥扩展名 → 非法字符换 `_` → 清首尾空白与结尾点 → 按**码点**截断 80 → 空则 `untitled`,顺序不可调)、`uniqueName`(**纯函数:只读 `used` 不写**,登记由调用方做;序号插在扩展名之前 `a.jpg → a-2.jpg`)、`buildZipFileName`(**本地时区**年月日,禁用 `toISOString()`,否则东八区下午之后天天错一天)、`displayNameOf`(只剥扩展名,不动非法字符)、`formatByteSize`(`0 B` / KB / MB / GB,非法体积给 `—`)、`outputNameOf`。
- 阶段 8 相对原方案的两处实现偏差,都是加强而非削弱:控制字符段用 `\p{Cc}` 代替字面量 `\x00-\x1f`(源码里不出现裸控制字符,顺带挡掉 C1 段 U+0080-U+009F);`uniqueName` 在 1000 格序号耗尽后的兜底链是「时间戳 → 4 位随机 → 确定性序号」而非只靠随机数,随机域被穷尽也能在有界步数内返回(1002 张同名文件的规模用例走的就是这条链)。

## 静态资源怎么替换

详见 `apps/admin/public/README.md`。摘要:

- 换 logo:把文件放进 `public/assets/logos/`,改 `public/logos.json` 的 `source`;`mark` 是文字兜底(预设图缺失或用户自定义上传时绘制文字块);
- 加相框样式:两步必须同时做 —— `src/utils/frame/style-registry.ts` 注册实现 + `public/frames.json` 加清单项;缺任一步装载期就报错(设计如此,不允许画不出来的样式出现在选项里);
- 清单里的 `thumbnail` 建议用导出页真渲染一张再另存,保证「所见即所得」;
- 字体:`public/fonts/` 三个 woff2 缺失不会导致导出失败(`loadFrameFonts` 返回 false,Canvas 退回系统字体栈),但观感会变。

## 构建与发布

```bash
pnpm --filter @monorepo-template/admin dev        # 本地开发(默认端口 8081,PORT 可覆盖;e2e 起在 18080)
pnpm --filter @monorepo-template/admin build      # 产物在 apps/admin/dist(public/ 资源拷进 dist/public/)
pnpm build:pages                                  # 按 Pages 子路径构建 + 产出 404.html(即 scripts/deploy-github-pages.sh)
```

- appTools 把 `public/` 拷进 `dist/public/` 并以 `<basePath>/public/<路径>` 提供,这就是任何资源引用都必须经 `assetUrl()` 的原因(它同时管 basePath 与 `public/` 段);

- **basePath 单一事实源**在 `modern.config.ts`:一个 `basePath` 变量同时决定 `output.assetPrefix`(带尾斜杠)、`source.define.__APP_BASE_PATH__`(不带,供 router basename 与 `assetUrl()` 使用)。优先级 `GITHUB_PAGES_BASE_PATH` > Actions 仓库名推断 > `ADMIN_BASE_PATH` > `/`;
- 子路径部署时把 `__APP_BASE_PATH__` 与 `assetPrefix` 写歪一处就是白屏,改这里必须同时验证两种构建;
- 生产构建注入 CSP meta,其中 `img-src` 必须含 `blob:`(图片预览与 zip 都是 Blob URL);
- GitHub Pages 无 rewrite 能力,深链刷新由 `dist/404.html`(= `index.html` 副本)接管;
- `.github/workflows/pages.yml` 只构建 admin,其余 app 不在发布链上。

## 测试

栈:**Vitest + React Testing Library(jsdom)**,配置 `apps/admin/vitest.config.ts`(其中 `define.__APP_BASE_PATH__` 必须与 `modern.config.ts` 同值),`pnpm --filter @monorepo-template/admin test` 执行;e2e 在根 playwright 的 `admin` project。

| 层       | 放什么                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 纯函数   | `tests/utils/**`:绘制指令记录与坐标断言、EXIF 段拼接、清单守卫、命名与体积格式化                                                                       |
| 状态机   | `tests/store/**`:装载状态机转移、导出进度计数收敛、持久化白名单                                                                                        |
| 组件交互 | `tests/{components,ui,hooks}/**`:PageContainer、ErrorBoundary、picker/preview、use-object-url 生命周期                                                 |
| 关键流程 | `tests/playwright/watermark-frame.spec.ts`:选图 → 导出 → 拿到 zip 一条黄金路径(**尚未补写**,`admin` project 已配好,起在 127.0.0.1:18080,见方案阶段 15) |

纪律:

- **渲染引擎不做像素对比**,用记录 `fillRect`/`fillText`/`drawImage` 调用参数的替身断言坐标与比例(jsdom 没有真 canvas,像素对比还得引 node-canvas,且抗锯齿差异会让用例长期红);
- 六类边界必查:空值 / 零值 / 越界 / 权限缺失(本站无鉴权,可注明不适用)/ 网络失败(清单装载与图片解码是真路径)/ 非法状态迁移(双击导出、取消后回报、total 计数收敛);
- 只 mock 模块边界(`assetUrl`、`fetch`、`Worker`、`URL.createObjectURL`),不为通过测试而 mock 被测函数的内部实现;
- jsdom 缺失的浏览器 API 统一在 `tests/setup.ts` 补,用例内不散补。

## 接口与契约

**本 app 不参与 `openapi/` 契约链**:`orval.config.ts`、`src/api/`、`gen:api` 已移除,`.prettierignore` 里对应的两行也已删。`openapi/admin.yaml` 仍在,但只服务 Go 侧的 gen/admin。

「数据契约」在本 app 里指两件本地的事:

1. `public/*.json` 的清单形状(运行时数据形状 → `src/types.ts`,校验 → `src/utils/catalog.ts`);
2. 渲染引擎的模块契约(`src/utils/frame/types.ts`,冻结事实源,所有 `utils/frame/**` 实现必须与之对齐,由 `export const xxx: XxxFn = ...` 的形式在编译期校验)。
