# 多端公共能力与 Hybrid 方案（mobile / miniapp / packages/js-bridge）

> 状态：**已完成**（方案记录 + 分阶段执行完毕；mobile 侧测试/联调待 Flutter 环境执行，见 §8 清单）
> 日期：2026-09-19
> 范围：三块——① mobile hybrid 能力（H5 嵌入 + JSBridge + H5 测试页）；② mobile 公共能力（页面状态/网络状态/生命周期/更新检查/Push/媒体/权限/曝光埋点）；③ miniapp 公共能力（曝光/ErrorBoundary/更新检查/页面状态/网络状态/网络层增强/生命周期接线）。跨 `apps/mobile`、`apps/miniapp`、`apps/h5`、`packages/js-bridge`、`openapi/app`、`apps/server` 六处。
> 编排约定：planner 出任务卡 + 2 个 coding-agent 并行执行 + 阶段门禁，与 docs/monorepo-expansion-plan.md 相同。
> 依赖前置：C 端用户体系（登录/Session/Token/Refresh）**独立成文档** docs/c-user-auth-plan.md，本计划只做挂点预留，见决策 1。

---

## 0. TL;DR

| 项            | 结论                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hybrid 链路   | `packages/js-bridge`（`@repo/js-bridge`，协议 + Promise 化 call/emit）→ mobile 侧 flutter_inappwebview 容器 + handler 注册表 → h5 `/jsbridge-test` 调试页调通 |
| JSB 协议      | js→native `callNative(method, params):Promise`；native→js `on/emit` 事件订阅；应答 `{code,data,error}`；非 webview 环境 reject `BRIDGE_NOT_AVAILABLE` 降级    |
| 首批 JSB 方法 | 四组：设备/网络/版本信息、UI 交互（toast/loading/标题）、页面跳转/容器控制、媒体/文件（依赖权限模块，随阶段 6 挂载）                                          |
| 更新检查      | openapi/app 新增 `version/check` 契约 + server 实现 + mobile 启动检查弹窗；miniapp 走 `wx.getUpdateManager`                                                   |
| Push          | 只定义 `PushService` 抽象 + 消息协议 + Noop 实现，SDK 后接（符合 core 抽象/Noop 双实现惯例）                                                                  |
| 权限          | `PermissionService` 统一抽象，懒请求 + 首次说明弹窗 + 永久拒绝跳设置，拒绝降级不阻断主流程；七类权限                                                          |
| 曝光埋点      | ≥50% 可见持续 300ms 触发，**页面级去重**（同页面实例同埋点位只报一次，重进可再报）；miniapp IntersectionObserver，mobile visibility_detector                  |
| 阶段排序      | Hybrid 先行（阶段 1→2→3），公共能力（阶段 4/5）与阶段 2/3 并行，媒体/权限（阶段 6）、更新/Push/曝光（阶段 7）随后，阶段 8 收口                                |
| 工作量        | 约 15~~20 人日；最大并行 2（planner 编排 + 2 coding-agent），并行后约 8~~10 日历天                                                                            |

---

## 1. 现状盘点

### mobile（apps/mobile，Flutter）

| 已有        | 说明                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| core 七模块 | config/logging/error/monitoring/analytics/network/storage，抽象 + Noop/Sentry 双实现，装配点 app_providers |
| 网络层      | dio：buildDio 工厂、信封解包（AppError 归一）、幂等 GET 重试、10s 超时、dioCall 统一边界                   |
| 存储        | KeyValueStore 抽象 + SharedPreferences 实现（未挂 Provider、无业务消费）                                   |
| 埋点/监控   | EventTracker（pageView/track）+ ErrorReporter + PerformanceMonitor                                         |
| 页面        | features/home 三态渲染样板（loading/success/failure+重试）、GoRouter、路由错误兜底页                       |
| 测试        | flutter_test 约 58 例（单测 + widget + integration）                                                       |
| **没有**    | webview/JSBridge（零代码）、登录/token、push、媒体、权限、更新检查、网络状态监听、通用页面状态组件         |

### miniapp（apps/miniapp，Taro 4 + React）

| 已有           | 说明                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core/track     | 事件模型 page_view/click/custom + 采样 + 公共参数 + usePageTrack                                                                                           |
| core/monitor   | 错误规范化（js_error/api_error/unhandled_rejection/page_not_found）+ 采样 + 全局钩子接线                                                                   |
| core/transport | 批量队列（batchSize 10/5s/上限 100/app hide flush）+ console/微信实时日志/HTTP 三 sink                                                                     |
| core/perf      | wx.getPerformance 采集 + mark                                                                                                                              |
| 网络层         | client.ts 唯一入口（Taro.request 直桥）、超时 10s、幂等重试 1 次、信封解包、失败挂 monitor                                                                 |
| 组件           | Skeleton、SafeImage                                                                                                                                        |
| **没有**       | ErrorBoundary、更新检查、onNetworkStatusChange 注册（params.ts 注释预留）、empty 页面态、通用 PageState、曝光埋点、onShow/onHide 显式 flush 接线、请求取消 |

### h5 / packages / 契约

| 项           | 现状                                                                  |
| ------------ | --------------------------------------------------------------------- |
| apps/h5 core | monitor/track/stability 齐备，SSR 安全，无任何 JSBridge 相关代码      |
| packages/    | 仅配置类包（eslint/prettier/tsconfig/commitlint），**无运行时共享包** |
| openapi/app/ | 仅 ping；无 version/check、无用户体系端点                             |
| apps/server  | app 受众 handler 仅 ping；无版本配置能力                              |
| 埋点事件惯例 | miniapp `track.page_view                                              | click | custom`；mobile EventTracker pageView/track——曝光新增 `expose` 语义挂进既有 facade |

---

## 2. 差距清单

| 域         | mobile 缺什么                                                        | miniapp 缺什么                                                             |
| ---------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| hybrid     | webview 容器、JSB native handler 注册表、JSB 方法实现                | —（测试页落在 h5）                                                         |
| 页面状态   | 通用 PageStateView（loading/empty/error/success），home 样板收敛复用 | 通用 PageState（补 empty 态）                                              |
| 曝光埋点   | visibility 探测 + expose 事件                                        | IntersectionObserver + expose 事件 + useExpose hook                        |
| 稳定性     | —（runZonedGuarded 三入口已收口）                                    | ErrorBoundary                                                              |
| 更新检查   | version/check 契约 + 启动检查弹窗                                    | wx.getUpdateManager 接线                                                   |
| 网络状态   | 网络状态监听（connectivity_plus）                                    | onNetworkStatusChange 注册 + refreshNetworkType 接线 + 断网提示 hook       |
| 生命周期   | 前后台事件接 tracker（app.foreground/app.background）+ flush 挂点    | onShow 刷新网络缓存、onHide flush 显式接线（transport 已自动，补语义事件） |
| 网络层增强 | 请求日志 interceptor、CancelToken 取消                               | 请求取消（RequestTask abort）、dev 请求日志、单请求超时覆盖                |
| 更新/Push  | PushService 抽象 + Noop                                              | —                                                                          |
| 媒体/权限  | PermissionService 七类权限、图片选择/压缩/缓存、文件选择、视频、音频 | —                                                                          |
| 共享包     | —（js-bridge 全新）                                                  | —                                                                          |

---

## 3. 决策记录

1. **C 端用户体系独立成文档**。登录/Session + Token/Refresh Token 不在本计划实现；另出 docs/c-user-auth-plan.md（openapi/app 契约 → server 用户/登录/token/refresh → 三端接入）。本计划只做挂点预留：mobile 侧网络层预留 token interceptor 挂点与 TokenStore 接口形态说明；miniapp client.ts 预留 token 注入挂点注释。理由：server 无 C 端用户体系，规则 23/25a 禁止匿名受众实现鉴权逻辑，范围失控风险高。
2. **WebView 选型 flutter_inappwebview**（钉版本，依赖评审）。javaScriptHandlerName 双向通道 + evaluateJavascript Promise 化，iOS/Android 行为一致；官方 webview_flutter 通道单向、JSBridge 需自拼两层消息泵，不选。
3. **JSB 协议：Promise 化 call/emit 双向**。js 侧 `callNative(method, params?):Promise<JSBResult>`（超时可控，默认 30s，0 = 不超时）；native 侧按 method 注册 handler 表分发；应答统一 `{code, data, error}`（code=0 成功）；native→js 事件 `on(event, handler)/off` 经 webview `evaluateJavascript` 注入分发；`isInApp()` 探测（`window.flutter_inappwebview` 存在性），纯浏览器环境 `callNative` reject `BRIDGE_NOT_AVAILABLE`，测试页据此降级展示。
4. **packages/js-bridge（`@repo/js-bridge`）**：TS、**零第三方运行时依赖**、vitest 单测、无构建产物（main 指向 src/index.ts，消费端 bundler 转译）；进 pnpm workspace，apps/h5 以 `workspace:*` 依赖消费。传输层适配器可注入（默认 flutter_inappwebview 适配器），协议核心与传输解耦。
5. **JSB 首批方法四组**：
   - 设备/网络/版本：`getDeviceInfo`、`getNetworkType`、`getAppVersion`（纯读、无权限）
   - UI 交互：`showToast`、`showLoading`、`hideLoading`、`setNavigationBarTitle`
   - 页面跳转/容器：`openPage`（native 路由表白名单）、`closePage`
   - 媒体/文件：`chooseImage`、`takePhoto`、`saveImageToAlbum`、`getImageInfo`（依赖阶段 6 权限模块，随阶段 6 挂载；**不含 uploadFile**——server 无上传端点，列后续阶段）
6. **H5 测试页公开保留**：正式路由 `/jsbridge-test`，按 handler 分组、每方法一卡片（参数输入 + 调用按钮 + 返回/错误展示）+ 事件订阅演示区；SSR 安全（client-only 挂载，`typeof window === "undefined"` 守卫）；非 webview 环境顶部降级提示。生产可见，方便真机随时验证。
7. **Push 只做抽象**：`PushService`（init/onMessage stream/getInitialMessage）+ `PushMessage{type, payload}` 消息协议（type 决定跳转路由）+ NoopPushService（dart-define `PUSH_ENABLED` 默认关）；JSB 预留 push 事件通道（native 收到推送经 emit 通知 H5）。SDK（FCM/厂商通道）后接，只换实现。
8. **更新检查走 server 契约**：openapi/app/ 新增 `GET /api/app/version/check`（platform + 当前版本 → hasUpdate/forceUpdate/latestVersion/downloadUrl/releaseNotes）；server 实现（版本配置读 env，admin 配置界面列后续阶段）；mobile 启动检查 + 更新弹窗（强制更新不可关闭）；miniapp 走 `wx.getUpdateManager`（dev 版本自动跳过）。
9. **媒体全量**：image_picker（相册/相机）、flutter_image_compress（压缩）、cached_network_image（图片缓存组件封装）、file_picker（文件选择）、video_player（视频）、just_audio（音频）；全部钉版本进 pubspec，遵守 mobile AGENTS §7 依赖评审。
10. **权限策略：懒请求 + 说明弹窗**。`PermissionService` 统一抽象：`check/request/openSettings` + 状态机 `granted/denied/limited/permanentlyDenied`；业务调用前 check，首次拒绝展示说明文案后可再请求，永久拒绝引导跳设置页；拒绝一律降级不阻断主流程。七类：camera/photo/location/notification/microphone/bluetooth/contacts。文案只出中文。
11. **曝光语义：页面级去重 + 50% 阈值**。进入可视区域 ≥50% 且持续 300ms 触发 `expose` 事件，同一页面实例内同一 trackId 只报一次，页面重新进入可再报；不做会话级/持久化去重（运营坑位需要重复曝光数据）。miniapp 用 IntersectionObserver（Taro.createIntersectionObserver），mobile 用 visibility_detector（钉版本）。
12. **阶段排序 Hybrid 先行**；本期边界排除（写进 §7）：文案只出中文、不做 offline 包/deeplink、不做平板与多小程序平台（只验微信）、不做性能基线测试、不做 JSB uploadFile（server 无上传契约）。

---

## 4. 目标架构

### packages/js-bridge（新增，@repo/js-bridge）

```
packages/js-bridge/
  package.json        # name @repo/js-bridge, private, main=src/index.ts, 零运行时依赖
  tsconfig.json       # extends @repo/tsconfig
  vitest.config.ts
  src/
    protocol.ts       # JSBRequest/JSBResponse/JSBResult/JSBErrorCode/超时常量
    core.ts           # createJSB(transport)：callNative Promise 化（callbackId、超时、错误归一）
    events.ts         # on/off/emit 事件总线（native→js 经 dispatchJSBEvent 注入）
    adapter.ts        # isInApp() + flutterInAppWebViewTransport（window.flutter_inappwebview.callHandler("jsb",…)）
    global.ts         # setupJSB/installWindowBridge（window.JSBridge 挂载，供调试与 native 注入）
  test/               # core/events/adapter 单测
```

### mobile（apps/mobile，新增部分）

```
lib/core/
  hybrid/
    jsb_registry.dart        # JSBHandler 表 + dispatch + AppError 化错误码映射
    jsb_methods/device.dart  # 设备/网络/版本 handler（纯读）
    jsb_methods/ui.dart      # toast/loading/标题 handler（闭包注入 UI 能力）
    jsb_methods/page.dart    # openPage（路由白名单）/closePage handler
    jsb_methods/media.dart   # 阶段6：chooseImage/takePhoto/saveImageToAlbum/getImageInfo
  permission/
    permission_service.dart  # check/request/openSettings + 状态机（permission_handler 实现）
    permission_rationale.dart# 首次拒绝说明弹窗（中文文案）
  media/
    media_picker_service.dart    # 相册/相机选图（image_picker）
    image_compress_service.dart  # 压缩（flutter_image_compress）
    cached_image.dart            # cached_network_image 封装组件
    file_service.dart            # 文件选择（file_picker）+ 临时文件管理
    video_service.dart           # video_player 封装
    audio_service.dart           # just_audio 封装
  update/
    version_repository.dart  # GET /api/app/version/check（走 dioCall/AppError 边界）
    update_checker.dart      # 启动检查 + 弹窗决策（hasUpdate/forceUpdate）
  push/
    push_service.dart        # PushService 抽象 + PushMessage 协议 + NoopPushService
  ui/
    page_state.dart          # PageStateView（loading/empty/error/success）+ PageStatus
    exposure_detector.dart   # 曝光探测封装（visibility_detector，50%/300ms/去重）
  network/
    request_log_interceptor.dart # 请求日志（AppLogger debug，dev 全量/prod ERROR）
    network_status.dart      # NetworkStatusService（connectivity_plus）
  lifecycle/
    app_lifecycle.dart       # 前后台事件 → EventTracker（app.foreground/app.background）+ flush 挂点
lib/features/webview/
  webview_page.dart          # InAppWebView 容器：onWebViewCreated 注册 handler、进度、错误态
```

### miniapp（apps/miniapp，新增部分）

```
src/
  component/
    error-boundary.tsx       # React ErrorBoundary，componentDidCatch → core/monitor
    page-state.tsx           # PageState（loading/empty/error/success）+ page-state-logic.ts
    expose-view.tsx          # <ExposeView trackId> 曝光容器（IntersectionObserver）
  hooks/
    use-expose.ts            # 曝光 hook（阈值/时长/去重决策在 core/track/expose-logic.ts）
    use-network-status.ts    # 网络状态订阅 hook
  core/
    update/index.ts          # checkUpdate(host)：wx.getUpdateManager，host 注入可测
    track/expose-logic.ts    # shouldExpose（50%/300ms）+ 页面级去重纯函数
  api/client.ts              # 增强：请求取消（RequestTask abort）、dev 请求日志、单请求超时覆盖、token 挂点注释
app.tsx                       # 接线：ErrorBoundary 根包裹、checkUpdate、onNetworkStatusChange、onShow 刷新网络缓存 + flushTrack/flushMonitor
```

### h5（apps/h5，新增部分）

```
src/routes/jsbridge-test/page.tsx   # 调试页（client-only），依赖 @repo/js-bridge workspace:*
```

### server（apps/server，新增部分）

```
internal/handler/version_handler.go   # 实现 gen/app ServerInterface 的 VersionCheck
internal/service/version_service.go   # 版本配置（env 覆盖）+ 比较逻辑 + 单测
openapi/app/paths/version-check.yaml  # 契约先行
openapi/app/components/schemas/version-check.yaml
```

---

## 5. 分阶段计划与并行编排

> 门禁：每阶段结束 planner 验收（lint/typecheck/test 通过 + 验收项核对）后才开下一阶段；两 coding-agent 的文件所有权必须互不相交。
> 测试纪律：每张任务卡先写测试用例再实现；六类边界（空值/零值/越界/权限缺失/网络失败/非法状态迁移）必查。
> 环境约束：**本机无 Flutter SDK**，mobile 侧 `flutter analyze/test` 无法本地执行——mobile 代码与测试照常交付，验证标记「待 Flutter 环境执行」，真机/模拟器联调步骤写成 runbook（§8 执行记录追踪）。

### 阶段 1：packages/js-bridge 包（并行度 1）

| 卡  | 范围                                                                                                     | 验收                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1.1 | 包骨架：package.json/tsconfig/vitest；protocol.ts 类型与错误码                                           | `pnpm lint/typecheck` 通过；类型可被独立消费                                                           |
| 1.2 | core.ts：createJSB(transport)——callbackId 分配、超时控制（默认 30s，0 关闭）、应答归一、错误码映射       | 单测：成功/native error/method 未注册/超时/非法应答/transport 抛异常 6 类                              |
| 1.3 | events.ts + adapter.ts + global.ts：事件总线、isInApp、flutter_inappwebview 适配器、window.JSBridge 挂载 | 单测：on/off/重复派发、isInApp 有无、适配器序列化往返；纯浏览器 callNative reject BRIDGE_NOT_AVAILABLE |

### 阶段 2：mobile webview 容器 + JSB native 侧（并行度 1，依赖阶段 1）

| 卡  | 范围                                                                                                                              | 验收                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 2.1 | pubspec 钉版本 flutter_inappwebview；core/hybrid/jsb_registry.dart（handler 表 + dispatch + 应答封装 + 错误码映射）               | registry 单测：未注册 method/参数非法/handler 抛错/正常往返        |
| 2.2 | core/hybrid/jsb_methods/{device,ui,page}.dart：纯函数 buildXxxHandlers(依赖闭包注入)；路由白名单表                                | methods 单测：参数校验（缺参/类型错/越界）、白名单外 openPage 拒绝 |
| 2.3 | features/webview/webview_page.dart + GoRouter `/webview?url=&title=`；onWebViewCreated 注册 handler + evaluateJavascript 事件派发 | 页面装配单测（handler 注册断言）；widget 测试待 Flutter 环境       |

### 阶段 3：h5 /jsbridge-test 调试页（并行度 1，依赖阶段 1；与阶段 2 可并行）

| 卡  | 范围                                                                                                             | 验收                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 3.1 | apps/h5 加 `@repo/js-bridge: workspace:*`；routes/jsbridge-test/page.tsx：client-only 挂载 + 非 webview 降级提示 | lint/typecheck/test 通过；SSR 构建不炸（无 window 顶层访问）                    |
| 3.2 | 调试页 UI：按组渲染方法卡片（参数输入 + 调用 + 结果/错误展示）+ 事件订阅演示区 + isInApp 徽标                    | 手动验收清单（浏览器降级态 + webview 态 runbook，Android 模拟器 10.0.2.2 说明） |

### 阶段 4：mobile 公共能力 A（并行度 1，依赖阶段 1 完成即可启动；与阶段 2/3 并行，文件不相交）

| 卡  | 范围                                                                                                                                                                                | 验收                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 4.1 | core/ui/page_state.dart（PageStatus + PageStateView）+ features/home 收敛复用                                                                                                       | widget 测试：四态渲染/重试回调/空文案（待 Flutter 环境）    |
| 4.2 | core/network/request_log_interceptor.dart（AppLogger，dev 全量/prod 仅 ERROR）+ dioCall 取消（可选 CancelToken 参数，存量调用不破坏）                                               | 单测：日志字段/级别门控、取消后 AppError 归一               |
| 4.3 | core/network/network_status.dart（connectivity_plus 钉版本）+ core/lifecycle/app_lifecycle.dart（前后台 → EventTracker app.foreground/background + flush 挂点）+ app_providers 装配 | 单测：状态机迁移/事件序列；装配不破坏现有 Provider 覆盖测试 |

### 阶段 5：miniapp 公共能力（并行度 1，与阶段 4 并行；文件所有权 apps/miniapp 全归本卡组）

| 卡  | 范围                                                                                                                                                                                                      | 验收                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 5.1 | component/error-boundary.tsx（componentDidCatch → core/monitor js_error）+ app.tsx 根包裹                                                                                                                 | vitest：渲染兜底/重置重试/上报调用断言                                   |
| 5.2 | component/page-state.tsx + page-state-logic.ts（补 empty 态）                                                                                                                                             | vitest：四态/文案兜底/onRetry                                            |
| 5.3 | core/track：TrackEventType 增 `expose`；core/track/expose-logic.ts 纯函数（50%/300ms/页面级去重）；hooks/use-expose.ts + component/expose-view.tsx（Taro.createIntersectionObserver）                     | vitest：阈值边界（49.9%/50%/299/301ms）、同实例去重、跨页面重置          |
| 5.4 | core/update/index.ts（wx.getUpdateManager，host 注入，dev 跳过）+ app.tsx 接线；hooks/use-network-status.ts + app.tsx onNetworkStatusChange 注册 + onShow 刷新网络缓存 + flushTrack/flushMonitor 显式接线 | vitest：host fake——更新回调三分支（ready/failed/dev 跳过）、网络状态迁移 |
| 5.5 | api/client.ts 增强：RequestTask abort 取消、dev 请求日志、单请求超时覆盖、token 注入挂点注释（不实现鉴权，决策 1）                                                                                        | vitest：取消后 reject 形态、超时覆盖生效、既有信封/重试用例不回归        |

### 阶段 6：mobile 权限 + 媒体 + JSB 媒体方法（并行度 1，依赖阶段 2）

| 卡  | 范围                                                                                                                                                | 验收                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 6.1 | core/permission/：PermissionService 抽象 + permission_handler 实现（七类）+ 状态机 + permission_rationale 弹窗；app_providers 装配                  | 单测：状态机迁移（granted/denied/limited/permanentlyDenied）、七类枚举完整性（待 Flutter 环境） |
| 6.2 | core/media/：media_picker/image_compress/cached_image/file/video/audio 六件（钉版本）                                                               | 纯逻辑单测（压缩参数/文件类型白名单）；插件调用薄壳待环境                                       |
| 6.3 | core/hybrid/jsb_methods/media.dart：chooseImage/takePhoto/saveImageToAlbum/getImageInfo（权限前置 check，拒绝返回权限错误码，降级不阻断）挂进注册表 | 单测：权限缺失分支、参数校验、返回结构（base64 dataUrl）                                        |

### 阶段 7：更新检查（契约先行）+ Push 抽象 + mobile 曝光（并行度 2，卡 7.1 与 7.2/7.3 文件不相交，依赖阶段 4）

| 卡  | 范围                                                                                                                                                                                                                                                                   | 验收                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 7.1 | openapi/app/ 新增 paths/version-check.yaml + schemas → `pnpm gen:api` → server internal/handler/version_handler.go + service/version_service.go（env 版本配置 + 比较 + 单测）→ mobile core/update/（version_repository + update_checker + 更新弹窗 feature，启动触发） | 契约 redocly lint 通过；server go test 通过；mobile 逻辑单测（比较/强制更新分支，待环境） |
| 7.2 | core/push/push_service.dart（PushMessage{type,payload} 协议 + NoopPushService + PUSH_ENABLED dart-define 开关）+ JSB push 事件通道预留                                                                                                                                 | 单测：协议解析/Noop 行为/开关装配                                                         |
| 7.3 | core/ui/exposure_detector.dart（visibility_detector 钉版本，50%/300ms/页面级去重）+ EventTracker expose 语义 + app_providers 装配                                                                                                                                      | 单测：去重决策纯函数（待 Flutter 环境）                                                   |

### 阶段 8：收口（并行度 1，依赖全部）

| 卡  | 范围                                                                                                                                                    | 验收                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 8.1 | AGENTS.md 护栏增补：apps/mobile（hybrid/JSB/权限/媒体目录与规则）、apps/miniapp（expose/update/error-boundary 使用规则）、apps/h5（jsbridge-test 说明） | 文档一致性核对             |
| 8.2 | 全量门禁：`pnpm verify`（lint/typecheck/test）、`pnpm gen:api` 幂等核对、miniapp e2e 冒烟、执行记录回填                                                 | 全绿；flutter 项标记待环境 |

### 排期与并行图

```
阶段1 js-bridge █████
        │
        ├─ 阶段2 mobile webview+JSB ████████ ──┐
        │                                      ├─ 阶段6 权限+媒体 ████████ ──┐
        └─ 阶段3 h5 测试页 ██████              │                             ├─ 阶段8 收口 ███
阶段4 mobile 公共能力A ████████（与2/3并行）───┼─ 阶段7.1 契约+server+更新 ███
阶段5 miniapp 公共能力 ████████（与4并行）─────┴─ 阶段7.2/7.3 Push+曝光 █████
```

（planner 编排，coding-agent×2：流水线 A = 阶段 2→6→7.1；流水线 B = 阶段 3→5→7.2/7.3；阶段 4 由先空闲的 agent 顺插。）

---

## 6. 风险清单

| 风险                                                      | 缓解                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 本机无 Flutter SDK，mobile 测试/编译无法本地验证          | 代码+测试照常交付并静态自查；执行记录显式标注待环境验证项；联调写成 runbook         |
| flutter_inappwebview 双端行为差异（iOS WKWebView 拦截等） | 钉版本 + 协议层只依赖 callHandler/evaluateJavascript 两个原语；runbook 双端真机核对 |
| iOS 审核风险（权限文案/强制更新）                         | 说明弹窗中文文案合规模板；强制更新仅用于重大缺陷，开关在 server 配置                |
| 媒体插件体积膨胀（image_picker/video_player 等）          | 逐插件钉版本评审；按需懒加载非首屏插件；记录 pubspec 依赖清单                       |
| 微信 IntersectionObserver 兼容性（基础库版本差异）        | expose-logic 决策逻辑抽纯函数单测；observer 创建失败降级为直接上报一次并记 monitor  |
| h5 调试页生产可见的信息暴露                               | 页面只读设备/版本信息、不暴露敏感数据；openPage 白名单在 native 侧兜底              |
| server version/check 配置漂移（env vs admin 页）          | 本期 env 只读 + 文档写明；admin 配置页列后续阶段                                    |
| 阶段 4/5 与 2/3 并行的文件冲突                            | 任务卡锁定文件所有权互不相交；AGENTS.md 改动集中在阶段 8                            |

---

## 7. 后续阶段（明确不在本次）

- C 端用户体系（独立文档 docs/c-user-auth-plan.md）：openapi/app 登录/token/refresh 契约、server 用户表与鉴权、三端接入、本计划预留挂点的填充
- Push SDK 实装（FCM/APNs 或厂商通道，由发行渠道决定），替换 NoopPushService
- admin 版本管理配置页（version/check 数据源从 env 迁库）
- JSB uploadFile / 文件上传（server 上传契约先行）
- offline 包 / 资源预加载、deeplink/schema 路由、webview 内原生导航栏深度定制
- l10n（权限文案/页面状态多语言，mobile gen-l10n 链启用）
- 平板/折叠屏适配、支付宝/抖音小程序平台
- 性能基线测试（帧率/内存）、mobile golden 测试

---

## 8. 执行记录

| 阶段   | 状态   | 提交              | 备注                                                                                                                                   |
| ------ | ------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 阶段 1 | 已完成 | 4c9e655           | @repo/js-bridge 落地；64 vitest 全绿，覆盖率 stmts/lines/functions 100%、branches 99%；零运行时依赖 lint 规则实测生效                  |
| 阶段 2 | 已完成 | 5708853           | JSB 协议镜像 1:1；53 个纯 Dart 镜像测试通过；flutter analyze/test 待 Flutter 环境                                                      |
| 阶段 3 | 已完成 | 0730c79           | h5 142 vitest 全绿（新增 10）；SSR 构建产物 curl `/jsbridge-test` 返回 200 实测验证                                                    |
| 阶段 4 | 已完成 | b6b00a8           | PS/RL/NS/LC 四组用例表落齐；dart analyze 0 问题；flutter 侧待环境                                                                      |
| 阶段 5 | 已完成 | 05b21ef           | miniapp 157 vitest 全绿（原 93）；core expose-logic 100% lines；覆盖率门槛保持 core ≥90%/整体 ≥70%                                     |
| 阶段 6 | 已完成 | 0fdfbd1           | 34 个 dart 用例；8 个插件钉版本；webview JSB 方法 9→13；flutter 侧待环境                                                               |
| 阶段 7 | 已完成 | b3d3ffc / bdc2cab | 7.1 契约+server+gen:api（幂等核对通过，curl 验收含 400/hasUpdate=false/forceUpdate 边界）；7.2-7.4 Push/曝光/更新客户端（dart 待环境） |
| 阶段 8 | 已完成 | （本提交）        | `pnpm verify` 全绿（14 turbo 任务 + desktop e2e + miniapp 体积门禁 319kB）；miniapp/h5 AGENTS 护栏增补；施工规格归档 docs/plans/       |

### 待 Flutter 环境验证清单

- `flutter create . --platforms=android,ios`（平台目录不提交）→ `flutter pub get` → `flutter analyze` → `flutter test`（PS/RL/NS/LC/R/D/U/P/MM/PU/E/VR/UC 全部用例 + 既有 58 例）
- §8 联调 runbook 全流程（真机/模拟器）
- `connectivity_plus 6.1.4`、`flutter_inappwebview 6.1.5`、`visibility_detector 0.4.0+2`、`url_launcher 6.3.2` 等钉版本在 lock 解析后回填确认（钉版本待评审）

### 联调 runbook（mobile webview × h5 测试页，待 Flutter 环境执行）

1. `cd apps/mobile && flutter create . --platforms=android,ios` 补齐平台目录
2. 启动后端 `pnpm dev`（18085）；启动 h5 dev（18082）
3. Android 模拟器：mobile dart-define `API_BASE_URL=http://10.0.2.2:18085`；webview 容器加载 `http://10.0.2.2:18082/jsbridge-test`
4. 核对：isInApp 徽标 → 设备/网络/版本三卡 → toast/loading → openPage/closePage → （阶段 6 后）chooseImage/takePhoto/saveImageToAlbum
5. 浏览器直开 `/jsbridge-test` 核对 BRIDGE_NOT_AVAILABLE 降级提示
