# desktop 通用壳建设方案：监控 / 埋点 / 稳定性 / 性能 / 测试

> 状态：**待评审 → 执行中**
> 日期：2026-09-19
> 范围：把 `apps/desktop` 从 hello-world 占坑升级为**通用桌面壳**——不含具体业务，预先建好 Arco 组件体系、性能优化、错误监控上报、埋点上报、稳定性设施、自动化测试，所有外部依赖点留配置坑，并以 `apps/desktop/AGENTS.md` 固化架构约束。后续业务直接在壳上开发。
> 前置：[`docs/monorepo-expansion-plan.md`](./monorepo-expansion-plan.md) 已落地 desktop 脚手架（electron-vite 5 + React 19 + orval 消费 `openapi/app/`）。

---

## 0. TL;DR

| 项         | 结论                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arco       | `@arco-design/web-react@^2.66.16`（对齐 admin）+ `@arco-plugins/vite-react@^1.3.3` 样式/图标按需；插件封装为可关配置坑，不兼容时回退全量 CSS               |
| 上报通道   | **自建统一管道**：渲染层错误/埋点经 preload IPC 汇入主进程，主进程 transport 批量发唯一 endpoint；ARMS 等第三方留 provider 坑                              |
| 配置坑     | 渲染层 `VITE_*`（import.meta.env 内联，成员访问）+ 主进程 `process.env.DESKTOP_*`；缺 endpoint 即不初始化（沿用 site RUM 模式）；`.env.example` 全量文档化 |
| 稳定性     | 单实例锁、渲染崩溃退避重载 watchdog、crashReporter、统一日志（主进程文件滚动 + 渲染层经 IPC 落盘）、导航白名单、权限默认拒绝                               |
| 性能       | manualChunks（react/arco/vendor）、hidden sourcemap（符号化坑）、路由懒加载占位（react-router Hash 模式）、窗口状态持久化                                  |
| 测试       | vitest 组件测试（jsdom + testing-library）+ playwright `_electron.launch` e2e 冒烟，**进 verify 与 CI（xvfb）**                                            |
| 留坑不实现 | 自动更新（`IUpdater` 接口 + URL 坑）、托盘/系统菜单/deeplink/多窗口（注释坑位）                                                                            |
| 工作量     | 约 3~4 人日；planner 编排 + coding-agent 执行，并行上限按实测 **2**                                                                                        |

---

## 1. 决策记录

1. **Arco 样式按需**：`@arco-plugins/vite-react`（1.3.3，2026-04 仍维护）做样式与图标按需加载。该插件在 `electron.vite.config.ts` 中以独立变量挂载并注释"可关回退"——构建失败或样式异常时删除插件、改 `import "@arco-design/web-react/dist/css/arco.css"` 全量兜底。
2. **上报自建统一管道**：主进程进程级 transport（内存队列 + 溢出落盘 `userData/report-queue.jsonl` + 启动重发 + 采样率），渲染层不直连上报端点。理由：主进程错误/崩溃本就只能自建，两条管道并存配置坑翻倍。
3. **配置坑模式照抄 site RUM**：endpoint/pid 缺任一不初始化、dev 默认关闭、返回 boolean 供测试断言、幂等。
4. **e2e 进 verify + CI**：playwright `_electron.launch` 打构建产物起真实窗口，冒烟级 1~2 用例；CI 用 `xvfb-run`。
5. **自动更新只留接口**：`src/main/updater.ts` 定义 `IUpdater` + `NullUpdater` + `DESKTOP_UPDATE_URL` 配置坑，不接 electron-updater（无更新服务端）。
6. **渲染层 env 纪律与 site 一致**：只经 `src/config` 成员访问，禁止裸 `process.env` / `import.meta.env` 散落业务代码。

## 2. 目标结构

```
apps/desktop/
  AGENTS.md                  # 壳架构约束(本次核心交付之一)
  .env.example               # 全部配置坑文档化
  src/
    main/
      index.ts               # 装配:单实例锁→日志→crashReporter→窗口→watchdog
      config.ts              # DESKTOP_* env 读取 + 默认值 + 类型
      logger.ts              # electron-log 封装(文件滚动,级别坑)
      crash.ts               # crashReporter + uncaughtException/unhandledRejection
      transport.ts           # 上报管道:批量/采样/落盘重发(net.fetch POST)
      ipc.ts                 # ipcMain.handle 白名单:report:track/report:error/log:write/shell:openExternal/theme:get
      window.ts              # createWindow + 安全基线(will-navigate 白名单、权限默认拒绝)
      window-state.ts        # 窗口宽高位置持久化(userData/window-state.json)
      watchdog.ts            # render-process-gone 退避重载(上限 3 次)
      updater.ts             # IUpdater 接口 + NullUpdater(坑)
    preload/
      index.ts               # contextBridge 白名单暴露 window.desktop.*
    renderer/
      src/
        sdk/
          monitor.ts         # onerror/unhandledrejection 采集 → IPC(幂等,无 endpoint 不初始化)
          track.ts           # pageView/event 批量队列 → IPC
        component/error-boundary.tsx  # Arco Result 兜底 UI + 上报
        config/index.ts      # VITE_* 唯一读取口(成员访问)
        routes/              # react-router Hash 模式 + lazy 占位(Home 保留 ping)
        ...
```

## 3. 配置坑清单（`.env.example` 全量文档化）

| 配置                                             | 进程 | 说明                                           |
| ------------------------------------------------ | ---- | ---------------------------------------------- |
| `DESKTOP_REPORT_ENDPOINT` / `DESKTOP_REPORT_PID` | 主   | 监控/埋点统一上报；缺任一全部不初始化          |
| `DESKTOP_REPORT_SAMPLE_RATE`                     | 主   | 采样率 0~1，默认 1                             |
| `DESKTOP_CRASH_SUBMIT_URL`                       | 主   | crashReporter submitURL；缺省只本地存 dump     |
| `DESKTOP_LOG_LEVEL`                              | 主   | 日志级别，默认 info                            |
| `DESKTOP_UPDATE_URL`                             | 主   | 更新服务坑（NullUpdater 不消费）               |
| `DESKTOP_NAV_ALLOWLIST`                          | 主   | will-navigate 白名单（逗号分隔，默认同源）     |
| `VITE_API_BASE`                                  | 渲染 | API baseURL（dev 走 proxy 留空，生产同域留空） |
| `VITE_TRACK_DISABLED`                            | 渲染 | 埋点强制关（dev 默认关）                       |

## 4. 分阶段计划与并行编排

编排沿用：planner 出任务卡（文件所有权 + 验收命令 + 禁止事项）→ coding-agent 执行 → 门禁。实测本环境 coding-agent 并行上限为 2，按 2 编排。

### 阶段 1：主进程壳（1 agent）

文件所有权 `apps/desktop/src/main/**`、`apps/desktop/src/preload/**`。装配顺序：单实例锁 → logger → crash → transport → ipc → window（含 window-state、安全基线）→ watchdog → updater 坑。依赖新增 `electron-log`。

### 阶段 2：渲染层壳（1 agent，与阶段 1 并行）

文件所有权 `apps/desktop/src/renderer/**`、`apps/desktop/electron.vite.config.ts`、`apps/desktop/package.json`（依赖：arco、arco 插件、react-router-dom、@testing-library/*、jsdom）。Arco + ConfigProvider（zh-CN、暗色跟随系统坑）、按需插件（可关回退）、sdk/monitor + sdk/track + ErrorBoundary、Hash 路由 + lazy 占位、manualChunks + hidden sourcemap。**约定：sdk 只调 `window.desktop.*` 桥，桥尚不存在时用可选链降级 console.debug，保证与阶段 1 解耦并行。**

### 阶段 3：测试 + 约束文档（1 agent，依赖 1+2）

文件所有权 `apps/desktop/tests/**`、`apps/desktop/vitest.config.ts`、`apps/desktop/playwright.config.ts`、`apps/desktop/AGENTS.md`、`apps/desktop/README.md`、`apps/desktop/.env.example`。组件测试（ErrorBoundary / track 队列 / config 解析）、e2e 冒烟（窗口标题 + ping 渲染 + `window.desktop` 桥存在）、AGENTS.md 壳约束（见 §5）、README 更新。

### 阶段 4：收口（1 agent，依赖 3）

`pnpm install`（独占 lockfile）→ 全量 lint/typecheck/test/build → 根 `test:e2e` 接入 desktop e2e（根 package.json 串联两个 playwright config）→ `scripts/verify.sh` 与 `ci.yml` 接 desktop e2e（CI 用 xvfb-run）→ 实跑 verify 全绿 → 联通冒烟（dev 起壳截图级验证由 e2e 覆盖）。

## 5. apps/desktop/AGENTS.md 要点（阶段 3 落地）

1. 三层边界：main（Node 系统能力）/ preload（唯一桥，contextBridge 白名单）/ renderer（纯 Web，禁 nodeIntegration、禁直连 Node API）；
2. IPC 白名单：渲染层只能用 `window.desktop.*`；新增能力 = main 注册 handler + preload 暴露 + AGENTS.md 登记，三步缺一不可；禁止 `ipcRenderer` 出现在 renderer 源码；
3. 上报纪律：业务代码只调 `src/sdk/*`，禁止手写上报 HTTP；monitor/track 无 endpoint 必须静默降级；
4. 配置纪律：渲染层 env 只能经 `src/config` 成员访问（同 site 规则）；新增配置坑同步 `.env.example` + 本文件清单；
5. 业务落位：页面进 `src/renderer/src/routes/`，复用件进 `component/`，壳代码（main/preload/sdk）禁止 import 业务模块；
6. 生成物禁手改（orval）；性能预算：首屏路由 chunk gzip < 150KB、arco 按需生效（构建产物抽查未引用组件不入场）。

---

## 6. 执行记录

| 阶段               | 状态      | 提交    | 备注                                                                   |
| ------------------ | --------- | ------- | ---------------------------------------------------------------------- |
| 0 方案评审         | ✅ 本文档 | —       | 2026-09-19，决策 1-6 由 planner 按推荐锁定（用户未作答，可逆项均留坑） |
| 1 主进程壳         | ✅ 完成   | efa31ea | 装配八步+transport 落盘重发+安全基线+watchdog+updater 块               |
| 2 渲染层壳         | ✅ 完成   | ea89704 | arco 按需+sdk 桥降级+Hash 路由 lazy+manualChunks+hidden sourcemap      |
| 3 测试 + AGENTS.md | ✅ 完成   | 2382406 | 组件测试 25 用例+_electron.launch 冒烟+AGENTS 六节+README              |
| 4 收口             | ✅ 完成   | 20d3383 | electron-log 入包+install;e2e 接 verify.sh+ci.yml(xvfb);根 verify 绿   |
