# apps/desktop — CMS 桌面端(electron-vite 通用壳)

CMS 的 Electron 桌面端(`@monorepo-template/desktop`):electron-vite + React(main / preload / renderer 三段式)通用桌面壳。错误监控上报、埋点上报、稳定性设施(单实例锁 / 渲染崩溃 watchdog / crashReporter / 日志落盘 / 导航白名单 / 权限默认拒绝)与性能预算已随壳预置,架构约束见 [AGENTS.md](AGENTS.md),壳方案见 [docs/desktop-shell-plan.md](../../docs/desktop-shell-plan.md)。

业务消费 C 端公开契约 [`openapi/app/openapi.yaml`](../../openapi/app/openapi.yaml)(与 `apps/miniapp`、`apps/mobile` 共享)。占坑期端点匿名只读;契约预留 `bearerAuth`,C 端用户体系落地前无鉴权逻辑。

## 命令

```bash
pnpm --filter @monorepo-template/desktop dev         # electron-vite dev:渲染层 dev server + Electron 窗口
pnpm --filter @monorepo-template/desktop build       # electron-vite build,产出 out/{main,preload,renderer}
pnpm --filter @monorepo-template/desktop test        # vitest:组件测试(jsdom)+ 纯逻辑单测
pnpm --filter @monorepo-template/desktop typecheck   # tsc --noEmit(tsconfig.node.json + tsconfig.web.json)
pnpm --filter @monorepo-template/desktop lint        # eslint
pnpm --filter @monorepo-template/desktop gen:api     # orval 生成 src/renderer/src/api/generated/ + controllers.gen.ts
pnpm exec playwright test -c apps/desktop/playwright.config.ts   # e2e 冒烟(仓库根执行,前置见下)
```

- 渲染层 dev server 端口 **18083**,`/api` 同源代理到 `http://127.0.0.1:18085`;
- e2e 冒烟走独立 playwright 配置(`_electron.launch` 打构建产物起真实窗口),暂未挂进根 `test:e2e`(收口阶段接入)。

## e2e 冒烟前置

1. 先出构建产物:`pnpm --filter @monorepo-template/desktop build`;`out/main/index.js` 或 `out/renderer/index.html` 缺失时用例整文件 skip;
2. Electron 运行时来自本 app devDependencies(`electron`),`@playwright/test` 由仓库根 devDependencies 提供;
3. 主进程有单实例锁(`src/main/index.ts`),playwright 配置固定 `workers: 1` 串行;
4. 无头 Linux / CI 环境用 `xvfb-run` 包裹。

## 配置坑表

渲染层 `VITE_*` 只能经 `src/renderer/src/config` 读取,主进程 `DESKTOP_*` 只在 `src/main/config.ts` 读取(纪律见 [AGENTS.md](AGENTS.md));缺省策略沿用 site RUM 模式:缺配置即不初始化。

| 配置                         | 进程 | 说明                                                                                                  |
| ---------------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| `DESKTOP_REPORT_ENDPOINT`    | 主   | 监控/埋点统一上报 endpoint,与 `DESKTOP_REPORT_PID` 成对,缺任一 transport 整条管道不初始化(dev 默认关) |
| `DESKTOP_REPORT_PID`         | 主   | 上报标识                                                                                              |
| `DESKTOP_REPORT_SAMPLE_RATE` | 主   | 上报采样率 0~1,默认 1(全量)                                                                           |
| `DESKTOP_CRASH_SUBMIT_URL`   | 主   | crashReporter submitURL;缺省只本地存 dump 不上传                                                      |
| `DESKTOP_LOG_LEVEL`          | 主   | 日志级别 `debug`/`info`/`warn`/`error`,默认 `info`                                                    |
| `DESKTOP_UPDATE_URL`         | 主   | 更新服务坑(NullUpdater 只提示不消费)                                                                  |
| `DESKTOP_NAV_ALLOWLIST`      | 主   | will-navigate / openExternal 白名单,逗号分隔,条目形如 `http://localhost:*` 按端口通配                 |
| `VITE_API_BASE`              | 渲染 | API baseURL;留空走同源(dev 由 electron-vite 代理、生产由网关同域转发)                                 |
| `VITE_TRACK_DISABLED`        | 渲染 | 置 `true` 强制关埋点;dev 构建默认关闭                                                                 |

## API 接入与联调

- API 层在 `src/renderer/src/api/`(orval 生成物 + `client.ts` mutator + `controllers.gen.ts`):匿名受众无会话,只做 `{code, message, data}` 信封解包与错误提示,无 token 注入与 401 跳转逻辑;
- axios baseURL 为空串,走同源相对路径:dev 由渲染层 dev server 把 `/api` 代理到 `http://127.0.0.1:18085`(见 `electron.vite.config.ts`),生产由部署侧网关同域转发;
- Go server 监听端口由 `SERVER_PORT` 控制(默认 8080),联调时保持与代理目标一致。

## 稳定性与上报链路

- 主进程装配顺序固定(见 `src/main/index.ts`):单实例锁 → logger(electron-log 文件滚动)→ crashReporter → transport(批量/采样/溢出落盘重发)→ ipc 白名单 → 窗口(状态持久化 + 安全基线)→ watchdog(渲染崩溃退避重载)→ updater 坑;
- 渲染层启动即装配 `sdk/monitor`(错误采集)与 `sdk/track`(埋点批量队列),全部经 `window.desktop.*` 桥汇入主进程,渲染层不直连上报端点;
- 未实现的留坑:自动更新(`IUpdater` + `DESKTOP_UPDATE_URL`)、托盘 / 系统菜单 / deeplink / 多窗口。
