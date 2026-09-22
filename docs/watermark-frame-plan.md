# 水印相框改造方案（apps/admin → 纯静态导出工具）

状态：**执行中**。本文是分阶段交付的记录与决策存档，实现约束的权威版本在 [../apps/admin/AGENTS.md](../apps/admin/AGENTS.md)，人读操作指南在 [admin.md](admin.md)。

- 起点：`apps/admin` 是一个 Modern.js + React 19 + Arco 的 CMS 管理后台（登录 + 动态菜单 + orval 契约客户端 + TanStack Query + Go 服务端）。
- 终点：`apps/admin` 是一个**完全静态、无服务端、无登录**的「水印相框」批量导出工具，发布到 GitHub Pages（子路径 `/photo-watermark/`）。
- 参考实现：`github.com/dkplus-pro/dkplus-photograhpy` 的 `apps/admin/src/features/frame-export`（Vite + 服务端驱动 + CDN 图片 + 数据万象处理）。本次是**搬运 + 去服务化改造**，不是复制：那边图片来自 CDN、EXIF 服务端预解析、质量档靠 `imageMogr2` URL 参数；这边全部发生在用户浏览器里、图源是本地 `File`。

## 1. 目标形态

```
左侧菜单：水印相框 → 相框列表（唯一一项）

/                          重定向到 /frames
/frames                    相框列表：一行 桌面4/平板3/手机2 的缩略图卡片，选项来自 public/frames.json
/frames/:styleId/export    导出表单：选图片(批量) + 选 logo(预设清单 + 末项自定义上传) + 选输出尺寸
                           → 「导出」→ 进度弹框 → 下载一个 zip
```

导出链路：

```
选图 → exifr 解析 EXIF → readHeadBytes(前 256KB) 存源图 APP1
     → probeMaxCanvasArea()(全局一次) + resolveOutputSize(源尺寸, 档位, 上限)
     → memoryAwareConcurrency(输出宽, 输出高, 张数) 定并发
     → FrameWorkerPool → Worker: FontFace 加载字体 / createImageBitmap 解码期缩放
                          / OffscreenCanvas + drawFrameComposition / convertToBlob(q=0.92)
                          / 零拷贝拼接 EXIF
     → fflate Zip(STORE) 边渲染边累积 Blob 分片
     → downloadBlob(zip, "frame-export-YYYY-MM-DD.zip")
```

## 2. 决策记录

| #   | 决策                                                                                                                                                                                                                                                                                                                                             | 理由与代价                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 只改 `apps/admin`；其余 6 个 app、Go 服务、`openapi/` 原样保留，admin 脱离契约链                                                                                                                                                                                                                                                                 | 需求边界。代价：`openapi/admin.yaml` 变成只服务 server 侧的孤儿契约，CI 的 `gen:api` 漂移检查不再覆盖前端 admin                                                                                                                                                                                                                              |
| D2  | 相框样式：JSON 只做清单（`id/name/thumbnail/sortOrder`），**样式实现走代码注册表**                                                                                                                                                                                                                                                               | 纯静态站没有地方放「可执行样式」。装载守卫强制「清单里有、注册表没有」直接报错，杜绝静默回落成错误产物                                                                                                                                                                                                                                       |
| D3  | 输出三档：**原图(≤24MP) / 中(12MP) / 小(3MP)**，JPEG 质量恒 0.92，只缩不放                                                                                                                                                                                                                                                                       | 取代参考实现靠 CDN 的 low/medium/high。移动端 24MP 不可行，档位是唯一让它跨端可用的手段；50 张 zip 体积从约 500MB 降到约 55MB（小档）                                                                                                                                                                                                        |
| D4  | 绘制几何**全部改纯比例**，删掉所有 `clamp` 上下限；唯一例外 `lineWidth = Math.max(1, w × 0.0012)`                                                                                                                                                                                                                                                | 用户明确要求。代价：极小画布上文字会被 `fitText` 重截断，不给下限。回归守卫是「300px 与 6000px 下所有绘制量比例一致且有限非负」的用例                                                                                                                                                                                                        |
| D5  | zip + 单次 anchor 下载；**不做「选择保存位置」**（否决了原需求里的这一条）                                                                                                                                                                                                                                                                       | File System Access API 在 Safari/iOS 与 Firefox 桌面均不可用，做不到跨端；逐张下载更差（iOS 每张弹一次系统面板、桌面要预先授权「允许多文件」）。代价：用户拿不到「自选目录」，落点后自己移动                                                                                                                                                 |
| D6  | 并发 = 内存感知（`memoryAwareConcurrency`）+ canvas 面积**探测**降级                                                                                                                                                                                                                                                                             | 「原尺寸 × Worker 并行 × 移动端」三角里唯一自洽解。按 `hardwareConcurrency` 开并发会在移动端被 jetsam 杀页                                                                                                                                                                                                                                   |
| D7  | 输入格式全收（jpeg/png/webp/avif/heic/heif），**解码失败的单张进失败列表**                                                                                                                                                                                                                                                                       | 不因一张 HEIC（Windows 上解不了）毁掉整批。列表页展示失败原因                                                                                                                                                                                                                                                                                |
| D8  | EXIF **完整继承源图 APP1**，只改 `Orientation→1` 与 `PixelX/YDimension→输出尺寸`；`piexifjs` 只碰 ≤256KB 头部，其余零拷贝 Blob 三段拼接                                                                                                                                                                                                          | 参考实现把整幅 JPEG latin1 字符串化，10MB 文件放大 4-6 倍内存，是必须消灭的事故源。`Orientation→1` 是因为像素已在解码期按原方向转正，原样保留会被查看器二次旋转                                                                                                                                                                              |
| D9  | 打包 webfont（Jost + Fira Sans 的 Latin 子集 woff2），**Worker 内用 `FontFace` 加载**                                                                                                                                                                                                                                                            | 相框文字观感依赖具体字体，`fitText` 的截断点取决于真实 `measureText`。已核实 FontFace-in-worker 支持面：Chrome 69+/Edge 79+/Firefox 105+/Safari 15+/iOS Safari 15+。取不到字体时 `loadFrameFonts` 返回 false，退回系统字体栈（观感降级不阻断）                                                                                               |
| D10 | 静态资源走 `apps/admin/public/` + 运行时 `fetch`，URL 一律经 `assetUrl()`                                                                                                                                                                                                                                                                        | 清单与 logo 要能被非技术用户替换（改 JSON + 丢文件），构建期常量做不到。代价：多两个同源请求                                                                                                                                                                                                                                                 |
| D11 | `basePath` 单一事实源：一个变量同时喂 `output.assetPrefix` / `source.define.__APP_BASE_PATH__`（→ router basename 与 `assetUrl`）；Pages 额外产出 `404.html = index.html`                                                                                                                                                                        | 原仓库 `APP_BASENAME="/admin"` 硬编码 vs Pages 感知的 `assetPrefix` 是两个值，子路径部署必白屏。Pages 无 rewrite，深链刷新靠 404.html 兜（状态码仍 404，但绝对前缀能让 SPA 接管）                                                                                                                                                            |
| D12 | **整壳适配**：<768px 时 `Sider` 不渲染，同一份菜单树进 `Drawer`；列表 桌面4/平板3/手机2                                                                                                                                                                                                                                                          | 不允许两份菜单实例并存（选中态与 `openKeys` 会分裂）。纯视觉差异用 `@media`，交互差异才用 hook                                                                                                                                                                                                                                               |
| D13 | 主题 = `arco.css` + `@arco-themes/react-juzi001/theme.css` 覆盖层；**不做暗色模式**                                                                                                                                                                                                                                                              | 引入顺序颠倒主题就失效。暗色模式对「看图」的工具是负担（照片底色是黑的，UI 变浅反而干扰判断）                                                                                                                                                                                                                                                |
| D14 | 应用名「水印相框」；`/`→`/frames`；logo = `public/assets/brand/logo.svg`（用户可替换）                                                                                                                                                                                                                                                           | 需求原文                                                                                                                                                                                                                                                                                                                                     |
| D15 | 三个领域 store（`ui` / `frame-catalog` / `export`）；ahooks `useResponsive`/`useMemoizedFn`/`useMount`/`useBoolean`/`useLocalStorageState`/`useDebounceFn`；lodash 深引入                                                                                                                                                                        | 一个项目只用一种全局状态方案。注意 ahooks `useResponsive` 语义是 **min-width**（`info[key] = innerWidth >= value`），键名要按这个语义取                                                                                                                                                                                                      |
| D16 | 测试 = 纯函数/状态机单测（**mock 2D context 记录绘制指令、断言坐标**）+ 一条 e2e 黄金路径；不做像素对比                                                                                                                                                                                                                                          | jsdom 无真 canvas；像素对比还要引 node-canvas，且抗锯齿差异会让用例长期红                                                                                                                                                                                                                                                                    |
| D17 | 渲染引擎放 `src/utils/frame/`（不是 `core/`、不是 `features/`）                                                                                                                                                                                                                                                                                  | 与仓库既有分区一致。代价：utils 出现「非纯工具」目录，已在 AGENTS.md 里显式登记这个例外                                                                                                                                                                                                                                                      |
| D18 | 实时预览固定按长边 1200px 渲染，与用户选的档位无关                                                                                                                                                                                                                                                                                               | 预览是排版判断不是成品；按 24MP 出预览会让移动端在预览阶段就崩                                                                                                                                                                                                                                                                               |
| D19 | 移动端张数 >20 时进度弹框给一条软提示，**不阻断**                                                                                                                                                                                                                                                                                                | 阻断会误伤「就 25 张且手机能扛」的真实场景                                                                                                                                                                                                                                                                                                   |
| D20 | 解码期缩放：`createImageBitmap(blob, {resizeWidth, resizeHeight, resizeQuality:"high"})`；不支持则退回全尺寸解码 + 逐级减半 `drawImage`                                                                                                                                                                                                          | 先解 24MP 全尺寸位图再缩 = 白分配约 96MB。这条有专门用例锁住（它是「传了 resize 选项」的守卫，不是「效果对」的守卫）                                                                                                                                                                                                                         |
| D21 | 多 agent 并行：17 个工作包 / 7 个 Wave，峰值并发 7（运行时上限 `min(8, 核数-2)`）；**同树协作不用 worktree**                                                                                                                                                                                                                                     | 见第 6 节。代价：必须靠「契约冻结 + 文件所有权互斥」防冲突，任何越界都会变成互相覆盖                                                                                                                                                                                                                                                         |
| D22 | **修订（阶段 8 落地时追加）· 三条下载/预览硬规则不许被「简化」**：① 禁止点击后立即 `revokeObjectURL`，必须走 `revokeObjectUrlLater(url, delayMs = 30_000)` 且默认值 > 0；② 下载 anchor 点击前必须挂进 `document`（`appendChild` → `click` → `remove`）；③ 预览已赋值的 object URL 要延迟回收（实测定时 600ms，见阶段 10），赋值后不得立即 revoke | 三条都是跨端可用性的因果，不是风格偏好：立即回收会让 Firefox/Safari 在大 Blob 上断流或落 0 字节；游离 anchor 在 Firefox 下根本不触发下载（参考实现把它包成 `withRevoke()` 高阶函数，把这两条一起抹掉了）；立即回收上一份预览 URL 则让 Safari 出现空白图。代价：`download.ts` 不能被写回三行形态，阶段 8 与阶段 9/10 各补一条时序守卫用例锁住 |

## 3. 内存与性能预算

单张在途任务的字节 ≈ 输出像素 × `BYTES_PER_PIXEL_JOB(8)`（解码位图 + 输出画布 + 编码缓冲）。

| 档位      | 输出像素  | 单任务 | 桌面（512MB 预算） | 移动（128MB 预算） |
| --------- | --------- | ------ | ------------------ | ------------------ |
| 原图 24MP | 6000×4000 | 192MB  | 2 并发             | 1 并发             |
| 中 12MP   | 4000×3000 | 96MB   | 4 并发（上限截断） | 1 并发             |
| 小 3MP    | 2000×1500 | 24MB   | 4 并发             | 4 并发             |

- 全局并发硬上限 `MAX_CONCURRENCY = 4`（再高收益递减）。
- 峰值常驻内存 ≈ 并发数 × 单任务字节：三档在桌面都约 384MB，移动端约 192/96/96MB。
- zip 是**流式累积**（`ZipPassThrough` STORE + `parts: Blob[]`）：每渲染完一张立刻推入，在途 Blob 数 = 并发数，浏览器会把大 Blob 落盘，JS 堆不会驻留 500MB。
- 50 张的 zip 体积量级：原图约 500MB / 中约 200MB / 小约 55MB —— 这也是把档位做成用户可选的直接原因。

## 4. 数据契约

### 4.1 静态清单（`public/*.json`，用户可自行替换）

```jsonc
// frames.json —— id 必须命中 style-registry 已注册项，否则装载期报错
{ "version": 1, "frames": [ { "id": "plain-frame", "name": "基础黑框",
  "thumbnail": "assets/thumbs/plain-frame.svg", "sortOrder": 10 } ] }

// logos.json —— mark 是文字兜底（预设图缺失或用户自定义上传时画文字块）
// 「自定义上传」这一项不进 JSON，由表单页在末尾固定追加
{ "version": 1, "logos": [ { "id": "juzi", "name": "芥子科技",
  "source": "assets/logos/juzi.svg", "mark": "JUZI" } ] }
```

守卫是手写的约 50 行（`src/utils/catalog.ts`），**不引入 zod**：静态站点每一点依赖都是 Pages 上的体积与维护面。三类失败机器可读可区分（`kind: missing | unreachable | invalid`），因为「资源没放对地方」和「JSON 写错了」的处置方式不同。

### 4.2 渲染契约（`src/utils/frame/types.ts`，冻结事实源）

所有 `utils/frame/**` 的实现都写成 `export const xxx: XxxFn = ...` 或 `class X implements XxxLike`，把跨模块签名交给编译器校验而不是靠约定。核心成员：

- 值：`SIZE_TIERS`（含 `maxPixels`）、`JPEG_QUALITY`、`PREVIEW_LONG_EDGE`、`EXIF_HEAD_BYTES`、`MEMORY_BUDGET_DESKTOP/MOBILE`、`BYTES_PER_PIXEL_JOB`、`MAX_CONCURRENCY`、`CANVAS_AREA_CANDIDATES`、`FALLBACK_CANVAS_AREA`；
- 数据：`PhotoExif`、`FrameFields`、`OutputSize`、`FrameJob`、`FrameRenderSettings`、`FrameTaskResult`、`FrameFailure`、`FrameOutcome`、`FrameExportSummary`、`FrameProgressHandlers`、`CancelToken`；
- 协议：`FrameRenderRequest` / `FrameWorkerMessage` / `FrameWorkerResult`；
- 函数类型：`DrawFrameComposition`、`LoadFrameFonts`、`ProbeMaxCanvasArea`、`ResolveOutputSize`、`MemoryAwareConcurrency`、`IsMobileEnvironment`、`SupportsWorkerRendering`、`ReadHeadBytes`、`BuildExifApp1`、`SpliceExifIntoJpeg`、`ExtractPhotoExif`、`FrameFieldsFromExif`、`RenderFrameBatch`、`RunFrameExport`、`RenderFrameCore`、`DecodeImageScaled`、`CreateFrameWorkerPool`、`AssetUrl`、`SanitizeBaseName`、`UniqueName`、`DownloadBlob`。

Worker 产物文件名恒为 `${主名}.jpg`，zip 内重名追加 `-2`/`-3`（参考实现里 Worker 与主线程降级路径的后缀不一致，本次在契约层就统一掉）。

`CANVAS_AREA_CANDIDATES` 的上界刻意停在 24MP（最高档的输出上限）：再大的画布本工具用不到，而为 268M 像素做探测本身就要分配约 1GB 缓冲，那是拿崩溃换信息。

## 5. 失败与文案口径

| 场景            | 文案                                                           | 处理                                    |
| --------------- | -------------------------------------------------------------- | --------------------------------------- |
| 清单 404        | `相框清单装载失败：frames.json 未找到（可能部署子路径不一致）` | 列表页 Alert + 重试                     |
| 清单内容非法    | `相框清单装载失败：第 2 项的 id "xxx" 未在样式注册表中登记`    | 同上，消息指向具体项                    |
| 图片无法解码    | `无法解码，浏览器可能不支持该格式（如 HEIC）`                  | 该张进失败列表，其余继续（D7）          |
| canvas 面积超限 | `画布创建失败：设备绘图上限不足，请改用更低档位`               | 提示用户降档，整批不崩                  |
| 字体加载失败    | 无用户可见提示                                                 | 静默降级系统字体（D9）                  |
| EXIF 注入失败   | 无用户可见提示                                                 | `exifInjected: false`，产物仍可用（D8） |
| 单张渲染异常    | `导出失败：<原因>`，列表最多展示前 3 条 + 「等 N 项」          | 汇总，不阻断其余                        |
| 全部失败        | `全部 N 张导出失败，未生成压缩包`                              | 不出 zip、不下载                        |
| 用户取消        | `已取消：已完成 X/Y 张`（保留已渲染结果但不打包）              | 池 `cancel()`，不 terminate 复用        |
| 移动端大批量    | 软提示：`移动端导出 20 张以上会较慢且占内存，建议选「小」档`   | 不阻断（D19）                           |

文件命名：产物 `<原文件名去扩展>.jpg`；非法字符 `\ / : * ? " < > |` 与控制字符替换为 `_`；截断到 80 字符且不切断代理对；空主名回落 `untitled`；zip 名 `frame-export-YYYY-MM-DD.zip`（**本地时区**，用 `toISOString()` 会让晚上导出的人看到昨天的日期）。

## 6. 多 agent 并行编排

### 6.1 Wave 表

| Wave | 并发      | 工作包                                                                            | 屏障（编排者验证后才放下一波）                    |
| ---- | --------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| 0    | 1（串行） | 1 清空与依赖收敛 → 2 壳/构建配置/契约冻结                                         | `typecheck` + 全量单测 + 两种 basePath 各构建一次 |
| 1    | 7         | 3 绘制引擎 · 4 EXIF · 5 能力探测 · 6 资源与清单 · 7 导出状态 · 8 工具 · 12 列表页 | `typecheck` + 全量单测                            |
| 2    | 3         | 9 Worker 池与内核 · 10 导出流水线 · 11 表单组件                                   | 同上                                              |
| 3    | 2         | 13 导出页装配 · 14 文档复核                                                       | 同上 + `pnpm build`                               |
| 4    | 1         | 15 e2e 黄金路径                                                                   | `playwright test --project=admin`                 |
| 5    | 1         | 16 集成验证（独占工作树，唯一允许跨文件修 bug 的包）                              | `pnpm verify` 全绿                                |
| 6    | 1         | 17 发布验证                                                                       | 已完成                                            |

运行时并发上限 `min(8, CPU核数 - 2)`；设计峰值 7（Wave 1）。Wave 边界是屏障：编排者跑校验，绿了才放下一波，红了就地修（谁的文件谁修，越界由编排者裁决）。

### 6.2 冲突控制

并行 agent 共享同一工作树（不用 worktree：产物要互相 import，worktree 会让「同一棵树里的契约」变成两个副本）。因此靠三条硬约束：

1. **契约先冻结**：Wave 0 交付 `src/utils/frame/types.ts`，Wave 1 起所有包只 import 它、不改它；接口对不上时不改对方文件，回报编排者改契约；
2. **文件所有权互斥**（每个包一份「拥有清单」，越界即评审失败）：
   - 1：删除清单 + `apps/admin/package.json` + `pnpm-lock.yaml` + 根 `tests/playwright/demo-app.spec.ts` + `.prettierignore`
   - 2：`modern.config.ts` `src/env.d.ts` `src/constants/index.ts` `src/utils/asset-url.ts` `src/utils/frame/types.ts` `scripts/deploy-github-pages.sh` `tests/smoke.test.ts` `vitest.config.ts` +（壳）`src/routes/{layout,page,$,index.css}` `src/config/menu.tsx` `src/components/{page-container,app-footer}.tsx` `src/store/ui.ts` `src/hooks/use-responsive.ts` `tests/{config/menu,ui/*}.test.*`
   - 3：`utils/frame/{frame-drawing,style-registry,fonts}.ts` + 对应用例
   - 4：`utils/frame/{exif,fields}.ts` + `tests/fixtures/*` + 对应用例
   - 5：`utils/frame/capability.ts` + 用例
   - 6：`public/**` `src/types.ts` `utils/catalog.ts` `store/frame-catalog.ts` `hooks/use-frame-catalog.ts` + 用例
   - 7：`store/export.ts` `hooks/use-object-url.ts` + 用例
   - 8：`utils/{download,file-name}.ts` + 用例
   - 9：`utils/frame/{render-core,frame.worker,worker-pool}.ts` + 用例
   - 10：`utils/frame/export-pipeline.ts` + 用例
   - 11：`routes/frames/$styleId/export/components/{image-picker,size-tier-picker,logo-picker,frame-preview}.tsx` + 用例
   - 12：`routes/frames/page.tsx` `routes/frames/components/frame-card.tsx` + 用例
   - 13：`routes/frames/$styleId/export/page.tsx` `.../components/export-progress-modal.tsx` + 用例
   - 14/14b：`docs/watermark-frame-plan.md` `apps/admin/AGENTS.md` `AGENTS.md` `docs/admin.md`
   - 15：`tests/playwright/watermark-frame.spec.ts` `playwright.config.ts`
   - 16：任何文件（独占执行）
3. **禁跑的**：Wave 内不得 `pnpm build`（并发争写 `apps/admin/dist`）、不得 `pnpm install`/改 `package.json`/改锁文件、不得任何 `git` 写操作（提交由编排者在 Wave 边界统一做）。允许的是 `tsc --noEmit` 与 `vitest run <自己的用例路径>`。

`pnpm typecheck` 是全局的，并行期间会看见别人写了一半的文件——这是**预期噪声**，每个包的验收口径是「我自己拥有的文件 0 错误」，Wave 屏障再收敛到全树 0 错误。

## 7. 已知技术风险

| 风险                                                                                             | 处置                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rspack 对 `new Worker(new URL("./x.worker.ts", import.meta.url), { type: "module" })` 的产出形态 | 阶段 9 按这个唯一可识别形式写；Wave 3 屏障真机 build + 浏览器验证 Worker 是否加载成功，失败则退 `import` 一个 worker 工厂（不改契约）                                                                                      |
| Worker 内 `FontFace` 在旧 Safari 不可用                                                          | `loadFrameFonts` 返回 false → 系统字体降级；`supportsWorkerRendering()` 缺失 FontFace 时整体走主线程路径                                                                                                                   |
| CSP `script-src 'self'` 是否放行同源 Worker 脚本                                                 | **已裁决：不补 `worker-src`**。`worker-src` 缺省时回落 `script-src`，同源 Worker chunk 被 `script-src 'self'` 覆盖；且构建把 Worker 打成内联 blob 引导脚本，CSP 已放行 `blob:`。真机若仍被拦，补 `worker-src 'self' blob:` |
| 移动端浏览器对大 Blob 落盘的行为不一致                                                           | STORE + 分片累积；必要时改 `zipSync`→分块 `zip` 回调（已在流水线里留出接缝）                                                                                                                                               |
| Pages 子路径推断依赖 `GITHUB_REPOSITORY`                                                         | 构建期用 `GITHUB_PAGES_BASE_PATH` 显式覆盖；两种 basePath 都进 Wave 0 屏障的构建验证                                                                                                                                       |

## 8. 验收清单

- [ ] `pnpm --filter @monorepo-template/admin build` 与 `GITHUB_PAGES_BASE_PATH=/photo-watermark` 构建都通过，产物内无 `__APP_BASE_PATH__` 残留、资源前缀正确、`404.html` 存在
- [ ] 全量单测绿，六类边界在**每个模块**的用例里都有落点（不适用要写明为什么）
- [ ] 一条 e2e：选图 → 导出 → 拿到 zip（移动视口与桌面视口各一轮）
- [ ] 真机验证：iOS Safari 与 Android Chrome 上「小」档 20 张能跑完、页面不被杀
- [ ] EXIF 抽查：导出图在查看器里方向正确、拍摄参数与原图一致、尺寸字段等于输出尺寸
- [ ] 无任何出网请求（DevTools Network 只剩同源资源）
- [ ] `pnpm verify` 绿；文档四处（本文件 + 两份 AGENTS + docs/admin.md）与实现一致

## 9. 分阶段实施编号与状态

| 阶段 | 内容                                                                                                                                                                                                                                                                                         | Wave | 状态                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------- |
| 1    | 清空 CMS：删接口层/登录/权限/媒体/系统页/上传 hook 与对应用例；依赖收敛（去 axios、react-query、dnd-kit、visactor、orval；加主题包、exifr、piexifjs、fflate）；`.prettierignore` 去两行；`pnpm install`                                                                                      | 0    | 已完成                       |
| 2    | 壳与构建配置：`basePath` 单一事实源、CSP 放行 `blob:`、标题「水印相框」、主题覆盖层、`layout` 去鉴权 + `Sider`/`Drawer` 双形态、菜单只剩一项、`matchMenuTrail` 改最长前缀匹配、`PageContainer` 支持显式面包屑、`store/ui`、`use-responsive`、`404.html`、**契约冻结 `utils/frame/types.ts`** | 0    | 已完成                       |
| 3    | 绘制引擎：`frame-drawing`（纯比例、去 clamp）、`style-registry`、`fonts`（双端 FontFace）+ 绘制指令单测                                                                                                                                                                                      | 1    | 已完成                       |
| 4    | EXIF：`readHeadBytes` / `buildExifApp1` / 零拷贝 `spliceExifIntoJpeg`、`extractPhotoExif`、`frameFieldsFromExif` + 合成夹具用例                                                                                                                                                              | 1    | 已完成                       |
| 5    | 能力探测：`probeMaxCanvasArea`、`resolveOutputSize`、`memoryAwareConcurrency`、`isMobileEnvironment`、`supportsWorkerRendering` + 用例                                                                                                                                                       | 1    | 已完成                       |
| 6    | 静态资源与清单：`public/`（清单 JSON、3 个预设 logo、缩略图、brand logo、3 个 woff2 子集、README）、`src/types.ts`、`utils/catalog.ts` 守卫、`store/frame-catalog`、`use-frame-catalog`                                                                                                      | 1    | 已完成                       |
| 7    | 导出状态：`store/export`（文件列表 + 档位 + logo + 进度状态机 + 偏好持久化白名单）、`use-object-url`（严格 revoke 生命周期）                                                                                                                                                                 | 1    | 已完成                       |
| 8    | 工具：`download`（anchor + 30s 延迟 revoke）、`file-name`（sanitize / unique / zip 名 / 体积格式化）                                                                                                                                                                                         | 1    | 已完成                       |
| 9    | Worker：`render-core`（解码期缩放 + 双 Surface + 资源释放）、`frame.worker`、`worker-pool`（懒创建 / id 配对 / 取消 / 崩溃摘除）                                                                                                                                                             | 2    | 已完成                       |
| 10   | 导出流水线：批次编排、失败收敛、fflate 流式 zip、进度回报、主线程降级                                                                                                                                                                                                                        | 2    | 进行中                       |
| 11   | 表单组件：`image-picker`、`size-tier-picker`、`logo-picker`（末项自定义上传）、`frame-preview`                                                                                                                                                                                               | 2    | 进行中                       |
| 12   | 列表页：`/frames` 网格（桌面 4 / 平板 3 / 手机 2）+ `frame-card`                                                                                                                                                                                                                             | 1    | 已完成                       |
| 13   | 导出页装配：`/frames/:styleId/export` 表单 + 进度弹框（取消、失败列表、软提示）                                                                                                                                                                                                              | 3    | 待开始                       |
| 14   | 文档：本文件 + `apps/admin/AGENTS.md` + 重写 `docs/admin.md` 与根 `AGENTS.md` 的 admin 段                                                                                                                                                                                                    | 1/3  | 主体已落档，待按最终实现复核 |
| 15   | e2e：`tests/playwright/watermark-frame.spec.ts` 黄金路径（桌面 + 移动视口）+ `playwright.config.ts` 的 admin project 调整                                                                                                                                                                    | 4    | 待开始                       |
| 16   | 集成验证：`pnpm verify` 全绿、两种 basePath 构建、跨包 bug 收敛（独占工作树）                                                                                                                                                                                                                | 5    | 待开始                       |
| 17   | 发布验证：Pages 构建产物检查 + 深链 404 兜底验证。**推 `main` 需用户显式确认，不进 workflow**                                                                                                                                                                                                | 6    | 待开始                       |
