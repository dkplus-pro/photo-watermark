# apps/desktop — 桌面通用壳架构约束(AGENTS.md)

本文件面向 AI 编码助手,固化桌面通用壳的架构纪律(方案与决策记录见
[docs/desktop-shell-plan.md](../../docs/desktop-shell-plan.md));命令与配置坑表见
[README.md](README.md)。业务开发直接在壳上落位,壳约束与业务代码同责。

## 1. 三层边界

- `src/main`(Node 系统层):唯一可使用 Electron 主进程 API 与 `process.env.DESKTOP_*` 的进程。`index.ts` 只做装配,固定顺序:单实例锁 → logger → crash → transport → ipc → window → watchdog → updater 坑;一个关注点一个文件,不写业务逻辑。
- `src/preload`(唯一桥):main ↔ renderer 之间唯一通道,`contextBridge.exposeInMainWorld("desktop", ...)` 白名单暴露 `window.desktop.*`;只暴露方法,禁止透传 `ipcRenderer` / `webContents` 等底层对象。
- `src/renderer`(纯 Web):禁 `nodeIntegration`(window.ts 安全基线已收口);禁止 `import "electron"`、禁止 `ipcRenderer`、禁止 Node 内置模块与 `process.env`。
- 依赖方向单向:renderer →(仅经 sdk 摸桥)→ preload → main;壳代码(main / preload / renderer 的 `sdk/`、`config/`)禁止 import 业务模块(`routes/` 页面等)。

## 2. IPC 白名单(三步纪律)

渲染层跨进程只能调 `window.desktop.*`。当前白名单(与 `src/preload/index.ts` 一一对应):

- `report.track` / `report.error`(sdk/track、sdk/monitor 专用);
- `log.write`(渲染层日志经主进程落盘);
- `theme.get`(系统主题查询);
- `openExternal`(白名单内外链交系统浏览器)。

新增能力三步缺一不可:

1. main `ipc.ts` 注册 `ipcMain.handle`;
2. preload 白名单暴露对应方法;
3. 本文件登记(含用途与消费方)。

禁止 `ipcRenderer` 出现在 renderer 源码;禁止绕过白名单另开通道。

## 3. 上报纪律

- 业务代码只调 `src/renderer/src/sdk/*`:错误采集与渲染边界上报走 `sdk/monitor`,埋点走 `sdk/track`;禁止手写上报 HTTP,渲染层禁止直连上报端点;
- 降级硬要求:无桥(桥未注入/测试环境)或上报失败必须静默(console.debug + 丢弃),上报管道不允许反噬业务;
- 主进程侧统一走 `transport.ts`(内存批量 + 溢出落盘 + 启动重发 + 采样);`DESKTOP_REPORT_ENDPOINT` / `DESKTOP_REPORT_PID` 缺任一,整条管道不初始化(dev 默认关)。

## 4. 配置纪律

- 渲染层 `VITE_*` 只能经 `src/renderer/src/config/index.ts` 成员访问读取(同 site 规则);`import.meta.env` 禁止散落业务代码,渲染层禁读 `process.env`;
- 新增渲染层配置坑三步:`src/renderer/src/env.d.ts` 登记类型 → `config/index.ts` 补默认值与语义字段 → 同步 `.env.example` 与本清单;
- 主进程 `DESKTOP_*` 只在 `src/main/config.ts` 读取,现有坑:`DESKTOP_REPORT_ENDPOINT` / `DESKTOP_REPORT_PID`(成对,缺任一不初始化)、`DESKTOP_REPORT_SAMPLE_RATE`(0~1,默认 1)、`DESKTOP_CRASH_SUBMIT_URL`(缺省只本地存 dump)、`DESKTOP_LOG_LEVEL`(默认 info)、`DESKTOP_UPDATE_URL`(更新坑,只提示不消费)、`DESKTOP_NAV_ALLOWLIST`(逗号分隔导航白名单,条目 `http://localhost:*` 按端口通配)。

## 5. 业务落位

- 页面进 `src/renderer/src/routes/`(Hash 路由;页面用 React.lazy 拆 chunk,首屏只留壳);2 个及以上页面复用的组件/hook 提到 `component/`、`hooks/`,单页面留页内;客户端全局状态用 zustand 进 `store/`;
- 接口一律走 orval 生成物(`api/generated/` + `api/controllers.gen.ts`,消费 `openapi/app/`),横切逻辑只写 `api/client.ts`,禁止手写请求函数;
- API baseURL 留空走同源:dev 由 electron-vite dev server 代理 `/api` 到 Go server,生产由网关同域转发;业务代码不拼绝对地址。

## 6. 生成物与性能预算

- orval 生成物(`src/renderer/src/api/generated/`、`src/renderer/src/api/controllers.gen.ts`)禁止手改;接口改动先改 `openapi/app/` 契约,再 `pnpm --filter @monorepo-template/desktop gen:api`;
- 性能预算:首屏路由 chunk gzip < 150KB(构建后对 `out/renderer/assets/` 抽查;react / arco / vendor 已由 manualChunks 分桶,勿拆散、勿把页面打进框架桶);
- arco 按需生效是硬要求:构建产物抽查未引用组件的样式不得入场(产物中不应出现全量 `arco.css`);若按需插件被关闭(见 `electron.vite.config.ts` 的 `enableArcoImportPlugin`),必须改走全量 CSS 兜底,并在构建后复查体积。
