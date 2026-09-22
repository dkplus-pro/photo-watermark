# 阶段 2/3 施工方案：mobile webview 容器 + JSB native 侧 / h5 jsbridge-test 调试页

> 对应 docs/hybrid-capability-plan.md 阶段 2（任务卡 2.1 / 2.2 / 2.3）与阶段 3（任务卡 3.1 / 3.2），
> 决策 2（flutter_inappwebview）、决策 3（JSB 协议）、决策 5（首批方法三组）、决策 6（测试页公开保留）。
> 本文件是给 coding-agent 的完整施工方案：**所有架构决策已做完，执行者不得自行变更 API 形态、文件结构、依赖版本、文案。**
> 目标分支：`refactor/big-infra`。协议依据：阶段 1 已交付的 `packages/js-bridge/src/*.ts`（本方案 §2 逐字镜像）。
> 阶段 4/5 施工方案见 docs/plans/hybrid-phase-4-5-spec.md；本方案与其**并行**，文件所有权互不相交（见 §9）。

---

## 1. 范围与边界

**阶段 2（apps/mobile，Flutter）做**：

- pubspec 增加 `flutter_inappwebview`（钉版本待评审，单行插入，见 §9 并行合并说明）。
- `lib/core/hybrid/`：JSB 注册表（jsb_registry.dart）+ URL 校验（webview_url.dart）+ 三组方法（jsb_methods/device.dart、ui.dart、page.dart）。
- `lib/features/webview/`：webview 容器页（webview_page.dart）+ 注册表装配（webview_jsb_registry.dart）。
- 路由：`/webview?url=&title=` 接入 `lib/router/app_router.dart`。
- `lib/core/config/app_config.dart`：新增 `appVersion` / `buildNumber` 两个配置坑（getAppVersion 数据源）。
- 纯逻辑单测全量交付；widget 测试只覆盖不触平台视图的分支（其余标记「待 Flutter 环境」）。

**阶段 3（apps/h5）做**：

- `apps/h5/package.json` 增加 `"@repo/js-bridge": "workspace:*"` 依赖并 `pnpm install`。
- 新增 `src/routes/jsbridge-test/` 调试页（client-only 挂载 + 非 webview 降级 + 方法卡片 + 事件订阅演示）。
- vitest 用例与实现同批交付。

**明确不做**：

- 不实现媒体 JSB 方法（chooseImage/takePhoto/saveImageToAlbum/getImageInfo）——阶段 6，依赖权限模块。
- 不实现 JSB 事件 native 主动推送给 H5 的业务场景（仅 webview 容器在加载完成时派发 `native.webview.ready` 演示事件，见 §5.6）。
- 不动 `lib/core/network/**`、`lib/app_providers.dart`、`lib/app.dart`、`apps/miniapp/**`（阶段 4/5 所有权，见 §9）。
- 不动 `packages/js-bridge/**`（阶段 1 已交付，协议以它为准）。
- 不回填 docs/hybrid-capability-plan.md §8 执行记录（planner 在阶段门禁时回填）。
- h5 侧不接 token/鉴权（根规则 23）；测试页生产可见但不暴露敏感数据（风险表已有结论）。
- 不做 offline 包 / deeplink / 多语言（计划文档 §7）。

---

## 2. JS 侧协议镜像（Dart 侧必须 1:1 对齐）

以下条目全部引自 `packages/js-bridge/src/` 已实现代码，是 Dart 侧的唯一协议事实源；**禁止另起协议**。

| 协议点         | JS 侧事实（文件：行级事实）                                                                                                                                                                                                     | Dart 侧对齐要求                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| handler 名     | `JSB_HANDLER_NAME = "jsb"`（adapter.ts）；transport 调 `window.flutter_inappwebview.callHandler("jsb", req)`                                                                                                                    | `webView.addJavaScriptHandler(handlerName: "jsb", …)`，常量 `kJSBHandlerName = 'jsb'`                                                                                                                   |
| 请求信封       | `JSBRequest { id: string; method: string; params?: Record<string, unknown> }`，作为 callHandler 的**第一个参数**原样引用透传                                                                                                    | callback 收到 `List<dynamic> args`，`args[0]` 即请求（Map 或 JSON 字符串）；`id` 读取留痕（日志关联），应答不回传                                                                                       |
| 应答信封       | `JSBResult { code: number; data?: T; error?: { code: string; message: string } }`；`code === 0`（`JSB_RESULT_OK`）成功取 `data`，否则读 `error`；对象**或 JSON 字符串**均可（normalizeJSBResponse 兼容）                        | handler 返回 `Map<String, dynamic>` 信封（插件序列化为 JSON，两侧形态都被 JS 兼容）；成功 `{code: 0}` 或 `{code: 0, data: …}`；失败 `{code: <非 0 int>, error: {code: <协议字符串>, message: <人话>}}`  |
| 错误码字符串   | 7 值联合：`BRIDGE_NOT_AVAILABLE / TIMEOUT / METHOD_NOT_FOUND / BAD_PARAMS / BAD_RESPONSE / NATIVE_ERROR / CANCELLED`（protocol.ts `JSB_ERROR_CODES`）；native 应答里未知字符串被 JS 收口为 `NATIVE_ERROR` 并保留进 `nativeCode` | **native 只产生 4 个码**：`METHOD_NOT_FOUND`（无注册 handler）、`BAD_PARAMS`（参数校验失败）、`NATIVE_ERROR`（handler 内部异常/兜底）、`CANCELLED`（阶段 6 预留，本期只定义不产出）。字符串必须逐字一致 |
| 失败数字码     | JS 侧 `mapNativeFailure` 读 `result.code`（number）做兜底 message 与 `nativeCode` 诊断；阶段 1 测试用例 C3 用 `1001` 搭配 `METHOD_NOT_FOUND`                                                                                    | 数字码锁定：`NATIVE_ERROR=1000`、`METHOD_NOT_FOUND=1001`、`BAD_PARAMS=1002`、`CANCELLED=1003`（与 JS 侧 C3 用例的 1001 约定一致）                                                                       |
| 事件 native→js | `window.__JSB_BRIDGE__.dispatchEvent(event, payload)`（global.ts `WINDOW_BRIDGE_KEY = "__JSB_BRIDGE__"`，installWindowBridge 的注入入口）                                                                                       | `evaluateJavascript` 注入 `window.__JSB_BRIDGE__ && window.__JSB_BRIDGE__.dispatchEvent(<jsonEvent>, <jsonPayload>);`，常量 `kWindowBridgeKey = '__JSB_BRIDGE__'`                                       |
| 环境探测       | `isInApp()`：`window.flutter_inappwebview` 存在且具备 `callHandler` 或 `postMessage`                                                                                                                                            | h5 测试页直接使用（阶段 3），Dart 侧无对应物                                                                                                                                                            |

---

## 3. 仓库既有约定（已核查，照此执行）

### mobile（apps/mobile）

| 项        | 取值                                                                                                                                                                                              | 出处                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 包名      | `cms_mobile`（import 用 `package:cms_mobile/...`）                                                                                                                                                | pubspec.yaml                       |
| 状态/装配 | Riverpod 3（`ConsumerWidget`/`ConsumerStatefulWidget`），core 服务经 `app_providers.dart` Provider 获取                                                                                           | AGENTS.md §1/§2                    |
| 依赖方向  | `features → core`；core 模块互不依赖（已登记例外：config 人人可用、error 为唯一错误模型、network→logging、lifecycle→analytics/logging）；**core/hybrid 只允许依赖 core/config**（不新增例外登记） | AGENTS.md §2                       |
| 路由      | go_router 18，`lib/router/app_router.dart` 单表，`state.uri.queryParameters` 取参                                                                                                                 | router/app_router.dart             |
| 页面三态  | `PageStateView` + `resolvePageStatus`（core/ui/page_state.dart，阶段 4 已落盘）                                                                                                                   | core/ui/page_state.dart            |
| 配置坑    | `AppConfig.fromDartDefines()`，禁裸读 `String.fromEnvironment`；新增 key 需同步 AGENTS.md §4 表与 README                                                                                          | AGENTS.md §3/§4                    |
| 测试      | `test/unit/`（纯逻辑）、`test/widget/`（经 test/helpers/pump_app.dart 范式）、fake 优先不引 mock 框架                                                                                             | test/ 现状                         |
| 验证      | `flutter analyze` / `flutter test`；**本机无 Flutter SDK，全部标记「待 Flutter 环境执行」**，代码与测试照常交付                                                                                   | hybrid-capability-plan §5 环境约束 |

### h5（apps/h5）

| 项        | 取值                                                                                                                                                       | 出处                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 包名      | `@monorepo-template/h5`（`pnpm --filter @monorepo-template/h5 …`）                                                                                         | package.json             |
| 路由约定  | Modern.js 文件路由：`src/routes/page.tsx` = `/`，`src/routes/<dir>/page.tsx` = `/<dir>`；loader 在 `<dir>.data.ts` / `page.data.ts` 具名导出               | src/routes 现状          |
| 页面壳    | `PageShell`（`src/component/page-shell.tsx`，内部已封装 arco `ContextProvider`，SSR 安全）                                                                 | component/page-shell.tsx |
| SSR 安全  | 环境判断统一 `typeof window === "undefined"`；**模块顶层禁止触碰浏览器 API**；客户端分支禁裸读 `process.env`                                               | AGENTS.md §3             |
| 监控/埋点 | 只经 `core/monitor`、`core/track` facade；本调试页**不接埋点**（纯诊断页）                                                                                 | AGENTS.md §4             |
| 样式      | 普通 CSS 文件 + 类名约定；px 书写由 postcss px-to-vw 转换（设计稿宽 375）                                                                                  | AGENTS.md §2             |
| 测试      | vitest，`tests/**`，默认 jsdom，SSR 分支用 `// @vitest-environment node` docblock；覆盖率门槛全局 ≥60 / `src/core/**` ≥80（本阶段不动 core，守住全局 ≥60） | vitest.config.ts         |
| 依赖方向  | `routes → {component, hooks, store, api, core}`；本页不引 arco 组件（理由见 §7.2）                                                                         | AGENTS.md §1             |

---

## 4. 阶段 2 文件清单（apps/mobile）

| 动作 | 文件                                                                      | 卡  |
| ---- | ------------------------------------------------------------------------- | --- |
| 修改 | `apps/mobile/pubspec.yaml`（插入 1 行依赖，见 §5.1）                      | 2.1 |
| 新增 | `lib/core/hybrid/jsb_registry.dart`                                       | 2.1 |
| 新增 | `lib/core/hybrid/webview_url.dart`                                        | 2.1 |
| 新增 | `lib/core/hybrid/jsb_methods/device.dart`                                 | 2.2 |
| 新增 | `lib/core/hybrid/jsb_methods/ui.dart`                                     | 2.2 |
| 新增 | `lib/core/hybrid/jsb_methods/page.dart`                                   | 2.2 |
| 新增 | `lib/features/webview/webview_jsb_registry.dart`                          | 2.3 |
| 新增 | `lib/features/webview/webview_page.dart`                                  | 2.3 |
| 修改 | `lib/router/app_router.dart`（加 `/webview` 路由）                        | 2.3 |
| 修改 | `lib/core/config/app_config.dart`（加 `appVersion`/`buildNumber` 两字段） | 2.2 |
| 修改 | `apps/mobile/AGENTS.md`（§4 配置坑清单表追加 2 行，**只动 §4**）          | 2.2 |
| 修改 | `apps/mobile/README.md`（配置坑表追加 2 行）                              | 2.2 |
| 新增 | `test/unit/jsb_registry_test.dart`                                        | 2.1 |
| 新增 | `test/unit/webview_url_test.dart`                                         | 2.1 |
| 新增 | `test/unit/jsb_methods_device_test.dart`                                  | 2.2 |
| 新增 | `test/unit/jsb_methods_ui_test.dart`                                      | 2.2 |
| 新增 | `test/unit/jsb_methods_page_test.dart`                                    | 2.2 |
| 新增 | `test/unit/webview_jsb_registry_test.dart`（装配断言）                    | 2.3 |
| 新增 | `test/widget/webview_page_test.dart`（仅非法 URL 分支；合法分支待环境）   | 2.3 |

**显式不碰**：`lib/app_providers.dart`、`lib/app.dart`、`lib/core/network/**`、`lib/core/ui/**`、`lib/features/home/**`、`apps/mobile/pubspec.yaml` 中除插入行以外的任何行。

---

## 5. 阶段 2 逐文件契约

### 5.1 pubspec.yaml（卡 2.1，单行插入）

在 `dependencies:` 段、`flutter:`（sdk）块**之后**、`flutter_localizations:` 块**之前**按字母序插入一行：

```yaml
flutter_inappwebview: ^6.1.5
```

- 6.1.x 为当前稳定线（6.x 提供 `addJavaScriptHandler` / `evaluateJavascript` 双原语，iOS/Android 行为一致，决策 2）。
- **钉版本待评审**：本机无 Flutter SDK 无法解析 lock；首个有 Flutter 环境的执行者跑 `flutter pub get` 后把解析到的精确版本回填进执行记录，若 6.1.5 不存在则取 6.1.x 最新并在评审记录中说明（与阶段 4 connectivity_plus 同流程）。
- **并行合并说明（pubspec 是唯一与阶段 4 相交的文件）**：阶段 4 在 `dependencies:` 段顶部插入 `connectivity_plus: ^6.1.4`（已落工作区）。本卡只允许插入上述一行；若 git 合并冲突，两行都保留且维持字母序（connectivity_plus < dio < flutter < flutter_inappwebview < flutter_localizations）。禁止顺手升级/重排其它依赖。

### 5.2 `lib/core/hybrid/jsb_registry.dart`（卡 2.1）

职责：JSB native 侧注册表——handler 表、dispatch、应答信封封装、错误码映射、raw 请求解码。**只允许 import `dart:async`/`dart:convert`**（不依赖 flutter、不依赖其它 core 模块，纯 Dart 可单测）。

完整契约（签名逐字锁定）：

```dart
import 'dart:async';
import 'dart:convert';

/// JSB handler 名(与 packages/js-bridge adapter.ts JSB_HANDLER_NAME 逐字一致)。
const String kJSBHandlerName = 'jsb';

/// window 注入键(与 packages/js-bridge global.ts WINDOW_BRIDGE_KEY 逐字一致)。
const String kWindowBridgeKey = '__JSB_BRIDGE__';

/// 成功码(与 JSB_RESULT_OK 一致)。
const int kJSBResultOk = 0;

/// 失败数字码(与 JS 侧 mapNativeFailure/阶段 1 测试 C3 约定一致)。
const int kJSBCodeNativeError = 1000;
const int kJSBCodeMethodNotFound = 1001;
const int kJSBCodeBadParams = 1002;
const int kJSBCodeCancelled = 1003;

/// 错误码字符串(protocol.ts JSB_ERROR_CODES 子集:native 只产生这 4 个)。
const String kJSBErrNativeError = 'NATIVE_ERROR';
const String kJSBErrMethodNotFound = 'METHOD_NOT_FOUND';
const String kJSBErrBadParams = 'BAD_PARAMS';
const String kJSBErrCancelled = 'CANCELLED';

/// handler 侧抛出的业务错误:code 为上表字符串,message 为人话(中文)。
class JSBException implements Exception {
  const JSBException(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => 'JSBException($code, $message)';
}

/// JSB handler:接收已解码的 params 对象(无 params 时为空 Map),返回 data 载荷。
/// 返回 null = 应答不携带 data 键。失败一律抛 JSBException(参数错)或任意异常(兜底 NATIVE_ERROR)。
typedef JSBHandler = Future<Map<String, dynamic>?> Function(Map<String, dynamic> params);

/// JSB native 注册表:method → handler;dispatch 输出协议信封(Map)。
class JSBRegistry {
  JSBRegistry();

  /// 注册单个 handler;重复注册同 method 抛 ArgumentError(非法状态护栏)。
  void register(String method, JSBHandler handler);

  /// 批量注册;任一重复(表内或跨表)抛 ArgumentError。
  void registerAll(Map<String, JSBHandler> handlers);

  bool hasMethod(String method);

  /// 已注册 method 数(装配断言用)。
  int get methodCount;

  /// 按 method 分发,返回协议信封 Map(成功 {code:0,data?},失败 {code,error:{code,message}})。
  /// 永不抛异常(所有失败归一为信封)。
  Future<Map<String, dynamic>> dispatch(String method, Map<String, dynamic> params);

  /// flutter_inappwebview addJavaScriptHandler 的 callback 入口:解码 args[0] → dispatch → 信封。
  /// 永不抛异常(解码失败/形态非法归一 BAD_PARAMS 信封)。
  Future<Map<String, dynamic>> handleRawCall(List<dynamic> args);
}
```

行为契约（括号内为 §6.1 测试用例编号）：

1. `dispatch` 未注册 method → `{code: 1001, error: {code: 'METHOD_NOT_FOUND', message: 'no handler registered for method "<method>"'}}`（R2）。
2. handler 返回非 null Map → `{code: 0, 'data': <map>}`；返回 null → `{code: 0}`（**不带 data 键**）（R1/R3，零值）。
3. handler 抛 `JSBException` → 信封 `error.code` 原样透传其 `code` 字符串；数字码按映射表：`NATIVE_ERROR→1000`、`METHOD_NOT_FOUND→1001`、`BAD_PARAMS→1002`、`CANCELLED→1003`；**未知 code 字符串 → 数字码 1000**，`error.code` 仍保留原字符串（JS 侧会收口为 NATIVE_ERROR 并把它保留进 nativeCode）（R4/R5）。
4. handler 抛非 JSBException（任意 Object/Error）→ `{code: 1000, error: {code: 'NATIVE_ERROR', message: e.toString()}}`（R6，网络失败/兜底）。
5. handler 返回同步值/抛同步异常同样成立——dispatch 内部统一 `await Future.sync(() => handler(params))` 形态（R7，非法状态）。
6. `handleRawCall` 解码规则：`args.isEmpty` → BAD_PARAMS 信封（message `'missing request argument'`）；`args[0]` 为 `String` → 先 `jsonDecode`（失败 → BAD_PARAMS `'request is not valid JSON'`）；解码后或本就是 `Map` → `Map<String, dynamic>.from(...)`（转换失败 → BAD_PARAMS `'request is not an object'`）；其它类型 → BAD_PARAMS `'request is not an object'`（R8~R11，空值/越界）。
7. 请求对象校验：`method` 缺失/非 String/`trim().isEmpty` → BAD_PARAMS 信封（`'request "method" must be a non-empty string'`）；`params` 键存在但非 Map → BAD_PARAMS（`'request "params" must be an object'`）；`params` 缺失或 null → 传空 Map 给 handler（R12~R14）。
8. `register`/`registerAll` 对空 method 字符串、重复 method 抛 `ArgumentError`（同步抛，R15/R16，非法状态）。
9. 信封**不回传** 请求 `id`（JS 侧 JSBResult 无 id 字段；id 仅供未来日志关联，本阶段读后可忽略）。
10. 全部 message 字符串中文优先；协议字段名（code/data/error/method/params）保持英文协议字面量。

### 5.3 `lib/core/hybrid/webview_url.dart`（卡 2.1）

职责：webview 目标 URL 校验（纯函数，单点）。`features/webview` 的路由参数守卫与 `jsb_methods/page.dart` 的 openPage 白名单规则共用此函数（core/hybrid 禁 import features，故函数必须放 core 侧）。

```dart
/// 校验并归一化 webview 目标 URL:仅放行 http/https;非法(空/解析失败/非 http(s))返回 null。
/// 归一化 = Uri.parse 后的原始串(trim 后);不做额外改写。
String? validateWebViewUrl(String? raw);
```

行为契约：null/空串/纯空白 → null（W1，空值）；`Uri.parse` 抛异常 → null（W2）；scheme（小写比较）非 `http`/`https` → null（`ftp:`/`file:`/`javascript:`/`about:blank` 全拒，W3，越界/安全）；合法 http/https（含大小写 scheme、带 query/fragment）→ 返回 trim 后的原串（W4/W5）。

### 5.4 `lib/core/hybrid/jsb_methods/device.dart`（卡 2.2）

职责：设备/网络/版本三个纯读 handler。**只允许 import `dart:io`（Platform）与 `package:cms_mobile/core/config/app_config.dart`**（config 是登记例外；**禁止 import core/network**——网络状态经闭包注入，见下）。

```dart
import 'dart:io';

import 'package:cms_mobile/core/config/app_config.dart';

import '../jsb_registry.dart';

/// 本文件提供的 method 名(装配与重复检查用)。
const List<String> deviceJSBMethodNames = <String>[
  'getDeviceInfo',
  'getNetworkType',
  'getAppVersion',
];

/// device 组依赖:全部闭包注入,纯 Dart 可测。
class JSBDeviceDependencies {
  const JSBDeviceDependencies({
    required this.config,
    required this.readNetworkType,
    this.readPlatform = _defaultPlatform,
    this.readOsVersion = _defaultOsVersion,
    this.readLocale = _defaultLocale,
  });

  /// 应用配置(getAppVersion 数据源)。
  final AppConfig config;

  /// 读取当前网络类型,返回 'online' | 'offline' | 'unknown'
  /// (接线见 features/webview/webview_page.dart:读 networkStatusServiceProvider.current.name;
  ///  阶段 4 NetworkStatusService 契约见 hybrid-phase-4-5-spec.md §4.3.2)。
  final String Function() readNetworkType;

  /// 以下三个读取器默认走 dart:io Platform;单测注入 fake。
  final String Function() readPlatform;   // 默认 Platform.operatingSystem
  final String Function() readOsVersion;  // 默认 Platform.operatingSystemVersion
  final String Function() readLocale;     // 默认 Platform.localeName
}

Map<String, JSBHandler> buildDeviceHandlers(JSBDeviceDependencies deps);
```

方法契约（参数一律忽略、允许空 params）：

| method           | data 载荷（成功时）                                                                               | 备注                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `getDeviceInfo`  | `{'platform': readPlatform(), 'osVersion': readOsVersion(), 'locale': readLocale()}`              | 纯读、无权限（决策 5）；Platform 只给这三个事实，**不引 device_info_plus**（零额外依赖） |
| `getNetworkType` | `{'networkType': readNetworkType()}`                                                              | reader 返回值不做二次校验（接线方按 'online'/'offline'/'unknown' 给）                    |
| `getAppVersion`  | `{'version': config.appVersion, 'buildNumber': config.buildNumber, 'flavor': config.flavor.name}` | config 两字段见 §5.7                                                                     |

三个 handler 均为同步读取包成 `Future.value`；读取器自身抛异常时不捕获（由 registry 兜底为 NATIVE_ERROR，D6 覆盖）。

### 5.5 `lib/core/hybrid/jsb_methods/ui.dart`（卡 2.2）

职责：UI 交互四个 handler。**纯 Dart，不 import flutter**——UI 能力全部闭包注入（webview_page 持 context 实现），本文件只做参数校验与调用编排。

```dart
import '../jsb_registry.dart';

const List<String> uiJSBMethodNames = <String>[
  'showToast',
  'showLoading',
  'hideLoading',
  'setNavigationBarTitle',
];

/// UI 组依赖:每页(webview 容器)持自己的 BuildContext 实现并注入。
class JSBUIDependencies {
  const JSBUIDependencies({
    required this.showToast,
    required this.showLoading,
    required this.hideLoading,
    required this.setNavigationBarTitle,
  });

  /// 展示 toast;long=false 短吐司(2s)/true 长吐司(4s)。
  final void Function(String message, {required bool long}) showToast;

  /// 展示加载遮罩(幂等:重复调用保持单个实例;text 为展示文案)。
  final void Function(String text) showLoading;

  /// 关闭加载遮罩(无实例时 no-op)。
  final void Function() hideLoading;

  /// 设置当前容器页原生导航栏标题。
  final void Function(String title) setNavigationBarTitle;
}

Map<String, JSBHandler> buildUIHandlers(JSBUIDependencies deps);
```

参数契约（校验失败一律抛 `JSBException(kJSBErrBadParams, <中文 message>)`，由 registry 归一为 BAD_PARAMS 信封）：

| method                  | params                                          | 校验规则（编号对应 §6.3）                                                                                                                                                                                                                                                                | data            |
| ----------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `showToast`             | `{message: string, duration?: 'short'\|'long'}` | `message` 缺失/非 string/`trim().isEmpty` → BAD_PARAMS `'showToast: "message" must be a non-empty string'`（U1，空值）；`duration` 缺省 `'short'`；存在但非 `'short'`/`'long'` → BAD_PARAMS `'showToast: "duration" must be "short" or "long"'`（U2，越界）。`long = duration == 'long'` | 无（返回 null） |
| `showLoading`           | `{text?: string}`                               | `text` 缺省/非 string → 回退默认文案 `'加载中…'`（不报错，U3）；其它键忽略                                                                                                                                                                                                               | 无              |
| `hideLoading`           | 无                                              | 无条件调用依赖（依赖方保证幂等 no-op，U4，非法状态）                                                                                                                                                                                                                                     | 无              |
| `setNavigationBarTitle` | `{title: string}`                               | 缺失/非 string/`trim().isEmpty` → BAD_PARAMS（U5，空值）；`trim()` 后长度 **> 64 字符** → BAD_PARAMS `'setNavigationBarTitle: "title" is too long (max 64)'`（U6，越界）；合法时以 `trim()` 后的值调用依赖                                                                               | 无              |

成功时四个 handler 均返回 `Future.value(null)`（信封无 data 键）。

### 5.6 `lib/core/hybrid/jsb_methods/page.dart`（卡 2.2）

职责：页面跳转/容器控制两个 handler + openPage 路由白名单。**不 import flutter/go_router**（导航能力闭包注入）；可 import `../webview_url.dart`（同模块）。

```dart
import '../jsb_registry.dart';
import '../webview_url.dart';

const List<String> pageJSBMethodNames = <String>['openPage', 'closePage'];

/// openPage 白名单 path 集合(native 侧兜底,H5 调试页生产可见的风险缓解,计划 §6)。
const Set<String> kOpenPageAllowedPaths = <String>{'/', '/webview'};

/// page 组依赖:导航能力由 webview 容器页经 GoRouter 注入。
class JSBPageDependencies {
  const JSBPageDependencies({
    required this.navigate,
    required this.canPop,
    required this.pop,
  });

  /// 跳转(实现方用 GoRouter push;入参为已拼好 query 的 location)。
  final void Function(String location) navigate;

  /// 当前页面可否出栈。
  final bool Function() canPop;

  /// 出栈(仅当 canPop 为 true 时调用方才调)。
  final void Function() pop;
}

/// openPage 参数校验 + location 拼装(纯函数,单测直测):
/// 合法返回 location 字符串;非法抛 JSBException(BAD_PARAMS)。
String resolveOpenPageLocation(Map<String, dynamic> params);

Map<String, JSBHandler> buildPageHandlers(JSBPageDependencies deps);
```

`resolveOpenPageLocation` 行为契约（编号对应 §6.4）：

1. `params['path']` 缺失/非 string/空白 → BAD_PARAMS `'openPage: "path" must be a non-empty string'`（P1，空值）。
2. `path` ∉ `kOpenPageAllowedPaths` → BAD_PARAMS `'openPage: path "<path>" is not in the whitelist'`（P2，权限缺失等价——白名单即本阶段的访问控制）。
3. `path == '/'` → 返回 `'/'`（`params` 键忽略）（P3）。
4. `path == '/webview'`：`params['params']` 必须是 Map（缺失/非 Map → BAD_PARAMS `'openPage: "params.url" is required for "/webview"'`）；其内 `url` 经 `validateWebViewUrl` 校验，null → BAD_PARAMS `'openPage: "params.url" must be a valid http(s) url'`；`title` 可选、非 string 时忽略。返回 `'/webview?url=${Uri.encodeQueryComponent(url)}'`（有 title 时追加 `&title=${Uri.encodeQueryComponent(title)}`）（P4/P5/P6，越界）。
5. `buildPageHandlers`：`openPage` = resolve → `deps.navigate(location)`，返回 null；`closePage` = `deps.canPop()` 为 true 则 `deps.pop()`，否则 no-op（P7，非法状态），返回 null。

导航语义（webview_page 注入实现时遵守）：`navigate` 一律 **push**（保持 webview 在栈内，closePage 可返回）；`closePage` 只出栈、不 go。

### 5.7 `lib/core/config/app_config.dart` 修改（卡 2.2）

新增两字段（getAppVersion 数据源；禁裸读 `String.fromEnvironment` 的合规落点）：

```dart
// 构造器新增 required 参数:
required this.appVersion,
required this.buildNumber,

// 字段:
/// 应用版本号(展示用);--dart-define APP_VERSION 注入,缺省与 pubspec version 对齐。
final String appVersion;

/// 构建号;--dart-define BUILD_NUMBER 注入,缺省 '1'。
final String buildNumber;

// fromDartDefines 内新增:
appVersion: const String.fromEnvironment('APP_VERSION', defaultValue: '0.1.0'),
buildNumber: const String.fromEnvironment('BUILD_NUMBER', defaultValue: '1'),
```

同步有界修改：

- `apps/mobile/AGENTS.md` §4 配置坑清单表追加两行（**只动 §4**，阶段 4 动的是 §2，区块不相交）：
  `| APP_VERSION | JSB getAppVersion 展示用版本号 | 默认 0.1.0 |` 与 `| BUILD_NUMBER | JSB getAppVersion 构建号 | 默认 1 |`
- `apps/mobile/README.md` 配置坑表追加同义两行。
- 既有构造调用点（main.dart 走 `fromDartDefines`、test 里 `_testConfig()` 等手写字面量构造处）需补两字段——**注意**：`test/unit/network_envelope_test.dart` 等已有测试的 `AppConfig(...)` 字面量构造必须同步补参，否则编译失败（全局 grep `AppConfig(` 逐一核对）。

### 5.8 `lib/features/webview/webview_jsb_registry.dart`（卡 2.3）

职责：三组 handler 的装配（features 层允许 import core/hybrid 与 core/config/network）。

```dart
import 'package:cms_mobile/core/hybrid/jsb_methods/device.dart';
import 'package:cms_mobile/core/hybrid/jsb_methods/page.dart';
import 'package:cms_mobile/core/hybrid/jsb_methods/ui.dart';
import 'package:cms_mobile/core/hybrid/jsb_registry.dart';

/// webview 容器加载完成后 native→js 的演示事件名(事件订阅 demo 的默认订阅事件)。
const String kWebViewReadyEvent = 'native.webview.ready';

/// 装配 webview 容器用注册表:device + ui + page 三组全量注册。
/// 重复 method 由 JSBRegistry.registerAll 抛 ArgumentError(装配期即暴露)。
JSBRegistry buildWebViewJSBRegistry({
  required JSBDeviceDependencies device,
  required JSBUIDependencies ui,
  required JSBPageDependencies page,
});
```

行为：`JSBRegistry()..registerAll(buildDeviceHandlers(device))..registerAll(buildUIHandlers(ui))..registerAll(buildPageHandlers(page))` 后返回；`methodCount == 9`（装配单测断言点，A1）。

### 5.9 `lib/features/webview/webview_page.dart`（卡 2.3）

职责：webview 容器页。`ConsumerStatefulWidget`。可 import：`flutter/material.dart`、`flutter_riverpod`、`flutter_inappwebview`、`go_router`、`dart:convert`、`core/hybrid/**`、`core/ui/page_state.dart`、`app_providers.dart`（读 `appConfigProvider` / `networkStatusServiceProvider`）。

构造：`const WebViewPage({super.key, required this.url, this.title});`（`url` 为路由 query 原值，可能 null/非法；`title` 可空）。

State 字段：`_controller (InAppWebViewController?)`、`_progress (double, 0..1)`、`_loadFailed (bool)`、`_pageTitle (String)`、`_loadingVisible (bool)`、`_registry (JSBRegistry, late，initState 装配)`。

行为契约（逐条锁定）：

1. **URL 守卫**：`build` 首行 `final validUrl = validateWebViewUrl(widget.url);`；为 null 时不构建 InAppWebView，渲染 `Scaffold(appBar: AppBar(title: Text('网页')), body: PageStateView(status: PageStatus.error, errorMessage: '链接无效或仅支持 http/https', onRetry: null))`（WP1，空值/越界/安全）。
2. **标题**：初始 `_pageTitle = widget.title?.trim() 非空 ? trim 后 : '网页'`；`setNavigationBarTitle` 注入实现 `setState(() => _pageTitle = t)`。
3. **InAppWebView 配置**：`initialUrlRequest: URLRequest(url: WebUri(validUrl))`；`initialSettings: InAppWebViewSettings(javaScriptEnabled: true)`；回调挂 `onWebViewCreated` / `onProgressChanged` / `onLoadStop` / `onReceivedError`（API 名按插件 6.1.x）。
4. **handler 注册（桥接点）**：`onWebViewCreated: (controller) { _controller = controller; controller.addJavaScriptHandler(handlerName: kJSBHandlerName, callback: (args) => _registry.handleRawCall(args)); }`——callback 返回的信封 Map 由插件序列化回 JS（JS 侧 normalizeJSBResponse 兼容对象/JSON 字符串两形态）。
5. **事件派发（native→js）**：私有方法 `Future<void> _dispatchJSBEvent(String event, Object? payload)`：
   ```dart
   final source =
       'window.$kWindowBridgeKey && window.$kWindowBridgeKey.dispatchEvent(${jsonEncode(event)}, ${jsonEncode(payload)});';
   await _controller?.evaluateJavascript(source: source);
   ```
   `onLoadStop` 时调用 `_dispatchJSBEvent(kWebViewReadyEvent, {'url': url?.toString() ?? validUrl})`（加载完成演示事件，供 h5 事件订阅卡片消费）。controller 未就绪时静默跳过。
6. **进度条**：`onProgressChanged` 更新 `_progress = progress / 100`；body 顶部 `LinearProgressIndicator(value: _progress < 1 ? _progress : null)`，加载完成（`_progress >= 1`）后可隐藏（用 `Visibility`/`if` 均可，锁定：`_progress < 1` 时渲染）。
7. **加载错误态**：`onReceivedError` 中 `request.isForMainFrame == true` 时 `setState(() => _loadFailed = true)`；渲染层叠：`_loadFailed` 时用 `Stack` 覆盖 `PageStateView(status: PageStatus.error, errorMessage: '页面加载失败', onRetry: () { setState(() => _loadFailed = false); _controller?.reload(); })`（WP2，网络失败）。
8. **device 组接线**：`JSBDeviceDependencies(config: ref.read(appConfigProvider), readNetworkType: () => ref.read(networkStatusServiceProvider).current.name)`——`NetworkStatusService`/`networkStatusServiceProvider` 契约见 hybrid-phase-4-5-spec.md §4.3.2/§4.3.5；**若执行时 `lib/core/network/network_status.dart` 尚未落盘（阶段 4 并行中），照常按本方案写引用**，编译验证标记「待阶段 4 合并后执行」（§9 并行说明）。纯单测（registry/methods/url/装配）不 import 该文件，可独立通过。
9. **ui 组接线**（全部判 `mounted` 后再操作，页面销毁后 JSB 调用到达时注入实现直接 no-op——不抛错）：
   - `showToast`: `ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), duration: Duration(seconds: long ? 4 : 2)))`；
   - `showLoading`: `_loadingVisible` 为 true 时直接返回（幂等）；否则置 true 并 `showDialog(context: context, barrierDismissible: false, builder: (_) => PopScope(canPop: false, child: Center(child: Card(...CircularProgressIndicator + Text(text)...))))`（形态从简，语义：模态、不可点穿、不可返回键关闭）；
   - `hideLoading`: `_loadingVisible` 为 false 直接返回；否则置 false 并 `Navigator.of(context, rootNavigator: true).pop()`；
   - `setNavigationBarTitle`: 见第 2 条。
10. **page 组接线**：`navigate: (location) => context.push(location)`；`canPop: () => GoRouter.of(context).canPop()`；`pop: () => context.pop()`（操作前判 `mounted`）。
11. **dispose**：若 `_loadingVisible` 残留，不主动 pop（对话框随页面出栈自然销毁）；无其它资源（controller 由插件生命周期管理）。
12. **文案**：本文件全部 UI 文案中文（`'网页'`/`'链接无效或仅支持 http/https'`/`'页面加载失败'`/`'加载中…'`）。

### 5.10 `lib/router/app_router.dart` 修改（卡 2.3）

`routes` 列表追加（保持既有注释风格，import 相应补 `../features/webview/webview_page.dart`）：

```dart
GoRoute(
  path: '/webview',
  builder: (context, state) => WebViewPage(
    url: state.uri.queryParameters['url'],
    title: state.uri.queryParameters['title'],
  ),
),
```

builder 保持薄——URL 合法性守卫在 WebViewPage 内（§5.9 第 1 条），路由层不做重定向。

---

## 6. 阶段 2 测试计划（全部纯逻辑可本机编写；执行标记「待 Flutter 环境」）

六类边界映射：空值（R8/R12/U1/U5/P1/W1/D 无）｜零值（R3/P7/E 默认文案）｜越界（U2/U6/P4/P5/W3）｜权限缺失（P2 白名单拒绝等价覆盖）｜网络失败（R6/WP2）｜非法状态迁移（R7/R15/R16/U4/P7）。

### 6.1 `test/unit/jsb_registry_test.dart`（R 系列）

| 用例                         | 内容                                                                                                  | 边界                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------- |
| R1 成功往返带 data           | 注册 echo handler 返回 `{'ok': true}` → dispatch 信封 `{code: 0, data: {'ok': true}}`                 | —                    |
| R2 未注册 method             | dispatch `'nope'` → `{code: 1001, error.code: 'METHOD_NOT_FOUND'}`，message 含 method 名              | —                    |
| R3 handler 返回 null（零值） | 信封 `{code: 0}` 且 **不含 data 键**（`containsKey('data')` 为 false）                                | 零值                 |
| R4 JSBException 已知码       | 抛 `JSBException(kJSBErrBadParams, 'x')` → `{code: 1002, error.code: 'BAD_PARAMS', message: 'x'}`     | —                    |
| R5 JSBException 未知码       | 抛 `JSBException('PERMISSION_DENIED', 'deny')` → 数字码 1000、`error.code` 保留 `'PERMISSION_DENIED'` | 权限缺失（等价）     |
| R6 非 JSBException 兜底      | 抛 `StateError('boom')` → `{code: 1000, error.code: 'NATIVE_ERROR'}`，message 含 'boom'               | 网络失败（兜底形态） |
| R7 同步 throw 归一           | handler 体直接 `throw`（非 Future 失败）→ 仍归一信封不向上抛                                          | 非法状态             |
| R8 空 args（空值）           | `handleRawCall([])` → BAD_PARAMS 信封                                                                 | 空值                 |
| R9 args[0] 为 JSON 字符串    | `jsonEncode({'method': 'm'})` 正常分发                                                                | —                    |
| R10 args[0] 非 JSON 字符串   | `'not-json'` → BAD_PARAMS                                                                             | 越界                 |
| R11 args[0] 非法类型         | `42` / `['x']` → BAD_PARAMS                                                                           | 越界                 |
| R12 method 缺失/空           | `{'id': '1'}`、`{'method': ''}`、`{'method': '  '}` → 均 BAD_PARAMS                                   | 空值                 |
| R13 params 非对象            | `{'method': 'm', 'params': 3}` → BAD_PARAMS                                                           | 越界                 |
| R14 params 缺省              | `{'method': 'm'}` → handler 收到空 Map（spy 断言 `isEmpty`）                                          | 空值                 |
| R15 重复注册                 | register 同名两次 → 第二次抛 ArgumentError；registerAll 表内重复同样抛                                | 非法状态             |
| R16 空 method 注册           | `register('', h)` → ArgumentError                                                                     | 非法状态             |
| R17 handler 异步失败         | handler 返回 `Future.error(...)` → 归一信封（dispatch 不抛）                                          | 网络失败             |

### 6.2 `test/unit/jsb_methods_device_test.dart`（D 系列）

fake 依赖：固定 `AppConfig` 字面量（含新字段）、`readNetworkType: () => 'online'`、`readPlatform: () => 'android'`、`readOsVersion: () => '34'`、`readLocale: () => 'zh_CN'`。

| 用例              | 内容                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| D1 getDeviceInfo  | data 三键值与 fake 一致；空 params 合法                                                                                |
| D2 getNetworkType | data `{'networkType': 'online'}`；另起 fake 返回 'offline'/'unknown' 各一例                                            |
| D3 getAppVersion  | data `{'version': '0.1.0', 'buildNumber': '1', 'flavor': 'dev'}`（与注入 config 一致）                                 |
| D4 method 名清单  | `deviceJSBMethodNames` 恰好为 `['getDeviceInfo', 'getNetworkType', 'getAppVersion']`；buildDeviceHandlers 键集与之相等 |
| D5 params 忽略    | 传 `{'junk': 1}` 不影响返回（三方法各一例可合并断言）                                                                  |
| D6 读取器抛错透传 | `readPlatform` 抛错 → handler Future 失败（由 registry 兜底，此处断言抛出即语义正确）                                  |

### 6.3 `test/unit/jsb_methods_ui_test.dart`（U 系列）

spy 依赖（记录调用参数的简单类，不引 mock 框架）。

| 用例                    | 内容                                                                                                     | 边界      |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | --------- |
| U1 message 缺失/空白    | 无 `message`、空串、纯空白 → 均 JSBException code BAD_PARAMS；spy 未被调                                 | 空值      |
| U2 duration 非法        | `duration: 'medium'` / `3` → BAD_PARAMS；缺省与 `'short'` → `long: false`；`'long'` → `long: true`       | 越界/零值 |
| U3 showLoading 默认文案 | 无 text → spy 收到 `'加载中…'`；`text: '稍等'` 透传；`text: 3`（非 string）→ 回退默认                    | 空值      |
| U4 hideLoading 幂等     | 连续两次调用均成功返回 null（依赖 spy 被调两次，幂等语义在实现方）                                       | 非法状态  |
| U5 title 缺失/空白      | → BAD_PARAMS；spy 未被调                                                                                 | 空值      |
| U6 title 越界           | 65 字符 → BAD_PARAMS；64 字符 → 成功；含首尾空白 → spy 收到 trim 后的值                                  | 越界      |
| U7 成功返回无 data      | 四方法各调一次 → 返回 null（经 registry dispatch 的信封无 data 键，与 R3 联动可在此直测 handler 返回值） | 零值      |

### 6.4 `test/unit/jsb_methods_page_test.dart`（P 系列）

| 用例                 | 内容                                                                                                                    | 边界             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------- |
| P1 path 缺失/空白    | `resolveOpenPageLocation({})` / `{'path': ' '}` → JSBException BAD_PARAMS                                               | 空值             |
| P2 白名单外拒绝      | `{'path': '/admin'}` → BAD_PARAMS 且 message 含 path                                                                    | 权限缺失（等价） |
| P3 根路径            | `{'path': '/'}` → 返回 `'/'`                                                                                            | —                |
| P4 /webview 缺 url   | `{'path': '/webview'}` / params 非 Map → BAD_PARAMS                                                                     | 空值             |
| P5 /webview url 非法 | `params: {'url': 'ftp://x'}` → BAD_PARAMS                                                                               | 越界             |
| P6 /webview 合法     | `params: {'url': 'https://a.b/c?d=1', 'title': '示例'}` → 返回 `/webview?url=<enc>&title=<enc>`；无 title → 无 `&title` | —                |
| P7 closePage         | canPop=true → pop 被调一次；canPop=false → pop 未被调且返回 null（no-op 成功）                                          | 非法状态         |
| P8 openPage 导航     | 合法入参 → navigate spy 收到 location；非法入参 → navigate 未被调                                                       | —                |
| P9 method 名清单     | `pageJSBMethodNames` == `['openPage', 'closePage']`；`kOpenPageAllowedPaths` 恰为 `{'/', '/webview'}`                   | —                |

### 6.5 `test/unit/webview_url_test.dart`（W 系列）

| 用例               | 内容                                                                   | 边界      |
| ------------------ | ---------------------------------------------------------------------- | --------- |
| W1 空值            | null/`''`/`'   '` → null                                               | 空值      |
| W2 解析失败        | 非法串（如 `'://'`）→ null（不抛）                                     | 越界      |
| W3 协议拒绝        | `ftp://a`、`file:///x`、`javascript:alert(1)`、`about:blank` → 全 null | 越界/安全 |
| W4 http/https 通过 | `http://a.b`、`https://a.b/p?q=1#f` → 原串返回                         | —         |
| W5 大小写与空白    | `'  HTTPS://A.B  '` → trim 后返回                                      | —         |

### 6.6 `test/unit/webview_jsb_registry_test.dart`（A 系列，卡 2.3 验收点）

fake 三组依赖（device 用 §6.2 fake，ui/page 用 spy）。

| 用例            | 内容                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A1 装配完整性   | `buildWebViewJSBRegistry(...)` 后 `methodCount == 9`；9 个 method 名逐一 `hasMethod` 为 true（清单 = device+ui+page 三常量拼接） |
| A2 无重复注册   | 三常量拼接后 `toSet().length == 9`（装配期重复会抛 ArgumentError，此断言防回归）                                                 |
| A3 装配后可分发 | 经 registry dispatch `getAppVersion` 成功；dispatch `showToast` 缺 message → BAD_PARAMS 信封                                     |
| A4 事件常量     | `kWebViewReadyEvent == 'native.webview.ready'`                                                                                   |

### 6.7 `test/widget/webview_page_test.dart`（WP 系列，最小化）

| 用例                    | 内容                                                                                                                                                                                                            | 边界      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| WP1 非法 URL 渲染错误态 | `WebViewPage(url: 'ftp://x')` 与 `url: null`（经 `WebViewPage(url: null)` 直构）→ 找到 `page-state.error` key 与文案 `'链接无效或仅支持 http/https'`；**不构建 InAppWebView**（find.byType(InAppWebView) 为空） | 空值/越界 |
| WP2 合法 URL 加载       | **待 Flutter 环境**（平台视图在 widget 测试不可用，标记 skip 或仅留 TODO 注释——锁定为：文件中只交付 WP1，WP2 以注释形式说明待环境）                                                                             | 网络失败  |

WP1 包装：照 `test/helpers/pump_app.dart` 范式 `ProviderScope(overrides: [...]) + MaterialApp(theme: AppTheme.light(), home: ...)`；所需 overrides：`appConfigProvider`（字面量 config）。非法 URL 分支不触 `networkStatusServiceProvider`（registry 虽在 initState 装配但 readNetworkType 闭包只在调用时读）——若实测 initState 提前读则补 override，执行时以编译/测试表现为准并在执行记录注明。

---

## 7. 阶段 3 文件清单与契约（apps/h5）

### 7.1 依赖接入（卡 3.1）

`apps/h5/package.json` `dependencies` 段，在 `"@modern-js/runtime": "^3.5.0"` 之后、`"ahooks"` 之前按字母序插入一行：

```json
    "@repo/js-bridge": "workspace:*",
```

随后根目录 `pnpm install` 链接 workspace 依赖（lockfile 变更随本卡提交）。不需要改 `pnpm-workspace.yaml`（`packages/*` glob 已收录）、不需要改 `turbo.json`（js-bridge 的 `build` 是 no-op，`^build` 链不断）。

### 7.2 文件清单（全部新增；不改动任何既有 h5 文件）

| 文件                                        | 职责                                                |
| ------------------------------------------- | --------------------------------------------------- |
| `src/routes/jsbridge-test/page.tsx`         | 路由页（默认导出）；SSR 安全壳 + 挂载后渲染调试面板 |
| `src/routes/jsbridge-test/jsb-setup.ts`     | JSB 初始化/释放（client-only）                      |
| `src/routes/jsbridge-test/method-groups.ts` | 方法分组元数据（纯数据，无依赖）                    |
| `src/routes/jsbridge-test/method-card.tsx`  | 单方法卡片组件（参数输入/调用/结果展示）            |
| `src/routes/jsbridge-test/page.css`         | 页面样式（普通 CSS，px 书写）                       |
| `tests/routes/jsbridge-test-setup.test.ts`  | 初始化/释放 + SSR 分支                              |
| `tests/routes/jsbridge-test-page.test.tsx`  | 页面降级渲染 + 卡片交互                             |

**arco 纪律**：本页**不直接 import 任何 arco 组件**——调试页以原生 button/textarea/pre 实现，避免为诊断页引入表单组件体积；页面仍套 `PageShell`（其内部封装的 `ContextProvider` 是壳约定，不属“页面直接 import arco”）。样式全部自写进 `page.css`。

### 7.3 `method-groups.ts`（纯数据契约，文案逐字锁定）

```ts
export interface JSBMethodMeta {
  /** 协议 method 名(与 native 注册表一致)。 */
  method: string;
  /** 卡片中文标题。 */
  label: string;
  /** 一句话中文说明。 */
  description: string;
  /** 参数输入框默认 JSON 文本。 */
  defaultParams: string;
}

export interface JSBMethodGroup {
  /** 分组 key(渲染用)。 */
  key: string;
  /** 分组中文标题。 */
  title: string;
  methods: JSBMethodMeta[];
}

export const jsbMethodGroups: JSBMethodGroup[];
```

内容逐字如下（三组九个方法；媒体组阶段 6 再挂，本期不出现）：

```ts
export const jsbMethodGroups: JSBMethodGroup[] = [
  {
    key: "device",
    title: "设备 / 网络 / 版本",
    methods: [
      {
        method: "getDeviceInfo",
        label: "获取设备信息",
        description: "返回平台、系统版本与语言环境。",
        defaultParams: "{}"
      },
      {
        method: "getNetworkType",
        label: "获取网络状态",
        description: "返回 online / offline / unknown。",
        defaultParams: "{}"
      },
      {
        method: "getAppVersion",
        label: "获取 App 版本",
        description: "返回版本号、构建号与环境档位。",
        defaultParams: "{}"
      }
    ]
  },
  {
    key: "ui",
    title: "UI 交互",
    methods: [
      {
        method: "showToast",
        label: "显示 Toast",
        description: "message 必填;duration 可选 short / long。",
        defaultParams: '{\n  "message": "你好,来自 H5",\n  "duration": "short"\n}'
      },
      {
        method: "showLoading",
        label: "显示加载中",
        description: "text 可选,默认「加载中…」。",
        defaultParams: '{\n  "text": "加载中…"\n}'
      },
      {
        method: "hideLoading",
        label: "隐藏加载中",
        description: "关闭当前加载遮罩,无遮罩时静默成功。",
        defaultParams: "{}"
      },
      {
        method: "setNavigationBarTitle",
        label: "设置导航栏标题",
        description: "title 必填,最长 64 字符。",
        defaultParams: '{\n  "title": "JSB 测试页"\n}'
      }
    ]
  },
  {
    key: "page",
    title: "页面跳转",
    methods: [
      {
        method: "openPage",
        label: "打开原生页面",
        description: "path 限白名单:/ 或 /webview;/webview 需 params.url(http/https)。",
        defaultParams: '{\n  "path": "/",\n  "params": {}\n}'
      },
      {
        method: "closePage",
        label: "关闭当前页面",
        description: "返回上一页;不可返回时静默成功。",
        defaultParams: "{}"
      }
    ]
  }
];

/** 事件订阅演示的默认事件名(native 在 webview 加载完成时派发)。 */
export const JSB_DEMO_EVENT = "native.webview.ready";
```

### 7.4 `jsb-setup.ts`（初始化契约）

```ts
import {
  createFlutterTransport,
  createJSB,
  installWindowBridge,
  resetJSB,
  setupJSB
} from "@repo/js-bridge";
import type { JSBRuntime } from "@repo/js-bridge";

export interface JSBTestHandle {
  runtime: JSBRuntime;
  dispose: () => void;
}

/** 初始化调试页 JSB 单例并挂 window.__JSB_BRIDGE__;SSR 返回 null(纯 no-op)。 */
export function initJSBTestBridge(): JSBTestHandle | null;
```

行为契约：

1. `typeof window === "undefined"` → 返回 `null`（S1，SSR 分支）。
2. 浏览器端：`setupJSB(createJSB(createFlutterTransport()))` → `installWindowBridge()` → 返回 `{ runtime, dispose }`；`window.__JSB_BRIDGE__` 四个方法（callNative/on/off/dispatchEvent）齐全（S2）。
3. 重复调用幂等（setupJSB/installWindowBridge 均覆盖语义，React StrictMode 双挂载安全，S3）。
4. `dispose()`：`delete window.__JSB_BRIDGE__;` + `resetJSB()`（S4）。

### 7.5 `method-card.tsx`（卡片组件契约）

```tsx
import { useState } from "react";
import type { JSBMethodMeta } from "./method-groups";

export interface JSBCallResult {
  /** 成功为 data(JSON 可序列化),失败为 null。 */
  data: unknown;
  /** 失败时的错误码(JSBError.code)或 "PARSE_ERROR"(参数 JSON 解析失败)。 */
  errorCode: string | null;
  errorMessage: string | null;
  /** nativeCode(JSBError.nativeCode)诊断透传,可空。 */
  nativeCode: string | number | null;
  /** 调用耗时(ms,performance.now 差值,四舍五入到整数)。 */
  elapsedMs: number;
}

interface MethodCardProps {
  meta: JSBMethodMeta;
  /** 实际调用(runtime.bridge.callNative 的引用透传)。 */
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

export default function MethodCard({ meta, call }: MethodCardProps): JSX.Element;
```

行为契约：

1. 结构：卡片标题行（`{label}` + 灰字 `{method}`）、说明行（`{description}`）、参数 textarea（默认 `meta.defaultParams`，受控）、「调用」按钮、结果区。
2. 点击「调用」：先 `JSON.parse(paramsText)`——失败**不发请求**，结果区显示 `参数 JSON 解析失败：<error.message>`（errorCode 固定 `"PARSE_ERROR"`，MC1，空值/越界）；解析为 `null` 按无参调用（传 `undefined`），解析为非对象（数字/数组/字符串）同样视为 PARSE_ERROR（`'参数必须是 JSON 对象'`）（MC2）。
3. 调用中按钮禁用并显示「调用中…」（防重复点击，MC3，非法状态）。
4. 成功：结果区样式成功态，显示 `JSON.stringify(data, null, 2)`（data 为 `undefined` 时显示字符串 `"(无返回值)"`）+ `耗时：{elapsedMs} ms`（MC4，零值）。
5. 失败：结果区错误态，显示 `{errorCode}: {errorMessage}`，有 nativeCode 时追加 `（native 原始码：{nativeCode}）`，同样显示耗时（MC5）。
6. elapsedMs 用 `performance.now()` 前后差（jsdom 亦可用）。
7. 组件无路由/loader 依赖、无模块顶层浏览器 API 访问。

### 7.6 `page.tsx`（页面契约）

```tsx
export default function JSBridgeTestPage(): JSX.Element;
```

行为契约（逐条锁定）：

1. **SSR 安全**：模块顶层只 import（@repo/js-bridge 全文件无顶层 window 访问，阶段 1 已保证）；组件函数体在挂载前**不调用** `isInApp()`/`initJSBTestBridge()`。用 `const [mounted, setMounted] = useState(false)` + `useEffect(() => { const h = initJSBTestBridge(); setHandle(h); setMounted(true); return () => h?.dispose(); }, [])`（P1）。
2. **渲染分两层**：
   - 未 mounted（SSR/首帧）：`PageShell` 内渲染标题 + `<p>正在初始化…</p>`（hydration 一致，两端同构输出，P1）。
   - mounted 后：完整调试面板。
3. **页面标题**：组件内 `<title>JSBridge 联调测试页</title>`（React 19 head 提升，与 layout 的 shareConfig 标题在本路由被覆盖——SSR 下同样渲染，布局 title 与本页 title 并存时 React 后者优先；此处照 layout 用法直接写）。
4. **环境徽标**：`const inApp = mounted ? isInApp() : false;` 徽标文案：在 App 内 `运行环境：App WebView`（成功态样式）；否则 `运行环境：浏览器`（中性态样式）（P2）。
5. **降级横幅**：`!inApp` 时在方法组之前显示横幅：`当前不在 App WebView 环境中，调用会失败(BRIDGE_NOT_AVAILABLE)。以下功能请在 App 内打开本页验证。`（P2，决策 6 降级要求）。
6. **方法组渲染**：遍历 `jsbMethodGroups` 渲染分组标题 + 卡片列表；`call` 实现为 `(method, params) => handle!.runtime.bridge.callNative(method, params)`（**不用** 包级 `callNative` 代理——未 setup 时 getJSB 同步抛，页面语义上挂载后必有 handle；handle 为 null 时不渲染卡片区）（P3）。
7. **事件订阅演示区**（分组标题 `事件订阅`）：事件名输入框（默认 `JSB_DEMO_EVENT`）、「订阅」/「取消订阅」按钮、接收记录列表（每条 `收到事件 {event}：{JSON.stringify(payload)}`，最新在上，上限保留 20 条）。订阅经 `handle.runtime.events.on(event, handler)`，返回的 unsubscribe 存 state；重复点「订阅」先退订旧记录再订阅（P4，非法状态）。取消订阅后按钮态复位。
8. **空 payload 显示**：payload 为 `undefined` 时显示 `"(无数据)"`（P5，零值）。
9. **无 router hooks**：本页不使用 `useLoaderData`/`useNavigate` 等（无 `.data.ts`，无 loader），保证 vitest 里可直接 `render(<JSBridgeTestPage />)`（P1 测试性约束）。
10. 样式：import `./page.css`；类名前缀 `jsb-`（如 `jsb-page`/`jsb-banner`/`jsb-group`/`jsb-card`/`jsb-result--ok`/`jsb-result--error`）。配色沿用壳变量（`var(--color-bg-1, …)` 可在 page.css 自定义，视觉从简：白底卡片、灰说明、绿成功、红错误）。

### 7.7 测试计划（tests/routes/，vitest）

**`jsbridge-test-setup.test.ts`**：

| 用例             | 环境                                                                                                                   | 内容                                               | 边界 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---- |
| S1 SSR 返回 null | `// @vitest-environment node` 独立 describe 文件顶部 docblock（整文件 node 环境）……**改为拆分**：node 环境用例放本文件 | 不 stub window 直接调 `initJSBTestBridge()` → null | 空值 |

> 注意：vitest docblock 是文件级开关。拆分两个文件：`jsbridge-test-setup.node.test.ts`（`// @vitest-environment node`，S1）与 `jsbridge-test-setup.test.ts`（jsdom，S2~S4）。afterEach 必须 `dispose()` + `resetJSB()`（防单例泄漏，照 js-bridge 测试纪律）。

| 用例              | 内容                                                               |
| ----------------- | ------------------------------------------------------------------ |
| S2 浏览器端初始化 | init → handle 非 null；`window.__JSB_BRIDGE__` 四方法均为 function |
| S3 幂等           | init 两次不抛；第二次的 handle 可用                                |
| S4 dispose        | dispose 后 `window.__JSB_BRIDGE__` 为 undefined                    |

**`jsbridge-test-page.test.tsx`**（jsdom；@testing-library/react + user-event，依赖已存在）：

| 用例                | 内容                                                                                                                                                                                     | 边界                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| P1 浏览器降级态     | render 后（act 等待 effect）出现 `运行环境：浏览器` 徽标与 BRIDGE_NOT_AVAILABLE 降级横幅；不出现 `App WebView` 徽标                                                                      | 空值（权限缺失等价——无桥环境） |
| P2 方法卡片齐全     | 9 个 method 名全部渲染；分组标题三个齐全 + `事件订阅` 区存在                                                                                                                             | —                              |
| P3 参数 JSON 非法   | showToast 卡片 textarea 清空输入 `{bad` → 点「调用」→ 出现 `参数 JSON 解析失败`；bridge 未被调（无桥环境下也不会出现 BRIDGE_NOT_AVAILABLE，而是 PARSE_ERROR）                            | 越界                           |
| P4 无桥调用失败展示 | 合法参数点「调用」→ 结果区出现 `BRIDGE_NOT_AVAILABLE` 与 `耗时：` 字样                                                                                                                   | 网络失败（桥缺失等价）         |
| P5 事件订阅         | 输入默认事件名点「订阅」→ 手动 `window.__JSB_BRIDGE__!.dispatchEvent("native.webview.ready", {url: "x"})` → 列表出现 `收到事件 native.webview.ready`；点「取消订阅」后再 dispatch 不新增 | 非法状态迁移                   |

**`method-groups` 元数据冒烟**（并入 page 测试文件即可）：`jsbMethodGroups` 展平后 9 项、method 名唯一、每个 `defaultParams` 可被 `JSON.parse` 且结果为对象或 `{}`。

### 7.8 阶段 3 验收命令

```bash
pnpm install                                        # 链接 @repo/js-bridge
pnpm --filter @monorepo-template/h5 lint
pnpm --filter @monorepo-template/h5 typecheck
pnpm --filter @monorepo-template/h5 test
pnpm --filter @monorepo-template/h5 build           # SSR 构建成功 = SSR 安全硬证据(无 window 顶层访问)
pnpm --filter @monorepo-template/h5 check:size      # build 已含,单独复核体积预算
```

### 7.9 阶段 3 验收标准

1. 五条命令全部退出码 0；`build` 通过即 SSR 安全证明（页面模块无顶层浏览器 API 访问）。
2. `tests/routes/jsbridge-test-*` 用例全绿；全局覆盖率门槛（≥60）不破。
3. `git status` 中 apps/h5 之外的改动**只有**根 `pnpm-lock.yaml`；不改 `packages/js-bridge/**`、不改 h5 既有文件。
4. 手动验收（浏览器态）：`pnpm --filter @monorepo-template/h5 dev` 起 18082，浏览器开 `http://localhost:18082/jsbridge-test` → 徽标「浏览器」+ 降级横幅 + 任意卡片调用显示 BRIDGE_NOT_AVAILABLE。
5. 手动验收（webview 态）：按 docs/hybrid-capability-plan.md §8「联调 runbook」执行（本方案 §10 引用不重写）；Android 模拟器用 `http://10.0.2.2:18082/jsbridge-test`。

---

## 8. 阶段 2 执行步骤与验收命令

```bash
# 1. 建目录与文件(§4 清单;先 core/hybrid 纯逻辑 → jsb_methods → features/webview → 路由 → 测试)
mkdir -p apps/mobile/lib/core/hybrid/jsb_methods apps/mobile/lib/features/webview

# 2. 纯 Dart 静态自查(本机无 Flutter SDK,以下命令全部标记「待 Flutter 环境执行」,
#    代码照常交付;在有 Flutter SDK 的环境执行):
cd apps/mobile
flutter pub get            # 解析 flutter_inappwebview,回填精确版本到执行记录(钉版本待评审)
flutter analyze
flutter test               # unit + widget(WP1)全绿

# 3. dart format(仓库风格交给格式化配置)
dart format lib/core/hybrid lib/features/webview lib/router lib/core/config test
```

阶段 2 验收标准（逐条核对）：

1. §4 文件清单全部落盘；`git status` 不含 §4 之外的 apps/mobile 改动（尤其未动 `lib/core/network/**`、`lib/app_providers.dart`、`lib/app.dart`）。
2. `flutter analyze` 无 error（待环境执行；若执行时阶段 4 未合并，`network_status.dart` 引用报错属预期，见 §9，待双方合并后复跑必须全绿）。
3. `flutter test` 全绿（待环境）：R/D/U/P/W/A 系列编号用例齐全，WP1 通过。
4. 协议一致性自查：`kJSBHandlerName == 'jsb'`、`kWindowBridgeKey == '__JSB_BRIDGE__'`、错误码字符串 4 个与 packages/js-bridge/src/protocol.ts 的 `JSB_ERROR_CODES` 子集逐字一致、数字码 1000/1001/1002/1003。
5. pubspec 仅新增 `flutter_inappwebview: ^6.1.5` 一行；`connectivity_plus` 行（阶段 4）保留不动。
6. AGENTS.md 改动仅 §4 表两行；README 配置坑表同步两行。
7. h5 联调前置核对（静态）：`evaluateJavascript` 注入串与 §5.9 第 5 条模板一致；`addJavaScriptHandler` 名为 `kJSBHandlerName`。

---

## 9. 并行冲突与合并说明（阶段 2/3 vs 阶段 4/5）

| 相交点                                                | 阶段 4/5 改动                                                                                                 | 本阶段改动                                                                                | 合并规则                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/pubspec.yaml`                            | 插入 `connectivity_plus: ^6.1.4`（dependencies 段首行）                                                       | 插入 `flutter_inappwebview: ^6.1.5`（flutter 块与 flutter_localizations 块之间）          | 两行都保留、维持字母序；冲突时手工合并，禁止互相覆盖                                                                                                       |
| `apps/mobile/AGENTS.md`                               | §2 例外清单追加两行                                                                                           | §4 配置坑清单追加两行                                                                     | 不同小节，天然不冲突；各自有界编辑                                                                                                                         |
| `lib/core/network/network_status.dart`（阶段 4 产物） | 新增 `NetworkStatusService` + `networkStatusServiceProvider`（契约见 hybrid-phase-4-5-spec.md §4.3.2/§4.3.5） | `webview_page.dart` **只读引用**（`ref.read(networkStatusServiceProvider).current.name`） | 阶段 2 执行时该文件若未落盘：照常写引用，`flutter analyze` 标记「待阶段 4 合并后执行」；**禁止**在 core/hybrid 内 import 它（依赖方向：闭包注入，见 §5.4） |
| `pnpm-lock.yaml`                                      | 无（miniapp 无新依赖）                                                                                        | 阶段 3 `pnpm install` 引入 @repo/js-bridge 链接                                           | 冲突时重新 `pnpm install` 生成                                                                                                                             |
| apps/miniapp、apps/server、openapi                    | 阶段 5 所有权                                                                                                 | 不碰                                                                                      | —                                                                                                                                                          |

---

## 10. 联调入口（引用，不重写）

真机/模拟器联调步骤以 docs/hybrid-capability-plan.md §8「联调 runbook（mobile webview × h5 测试页）」为准（`flutter create . --platforms=android,ios` 补平台目录 → server 18085 + h5 18082 → Android 模拟器 `API_BASE_URL=http://10.0.2.2:18085`、webview 加载 `http://10.0.2.2:18082/jsbridge-test` → 逐项核对：isInApp 徽标 → 设备/网络/版本三卡 → toast/loading → openPage/closePage → 事件订阅区应收到的 `native.webview.ready` → 浏览器直开降级提示）。本方案新增的核对项：**事件订阅演示区默认事件 `native.webview.ready` 在页面加载完成后自动收到一条记录**（§5.9 第 5 条派发）。

---

## 11. 易错点清单（实现时逐项自查）

1. **协议字面量**：`jsb` / `__JSB_BRIDGE__` / 错误码字符串必须与 packages/js-bridge 逐字一致，禁止凭记忆改写；写完 grep 对照 `packages/js-bridge/src/adapter.ts` 与 `global.ts`。
2. **信封无 data 键 vs data: null**：handler 返回 null 时成功信封**不得**携带 `data` 键（JS 侧 `resolve(undefined)` 语义差异，R3/U7 锁定）。
3. **dispatch 永不抛**：所有 handler 失败（含同步 throw）归一为信封；只有 `register`/`registerAll` 的非法注册同步抛 ArgumentError（两套语义勿混，对应 JS 侧 callNative reject vs createJSB 同步抛的区分）。
4. **依赖方向**：`core/hybrid/**` 只 import `dart:*` 与 `core/config/app_config.dart`；网络状态/导航/UI 能力全部闭包注入（§5.4/§5.5/§5.6）。在 `core/hybrid` 里 import flutter/go_router/core-network 均属违规。
5. **AppConfig 字面量构造点**：加字段后全局 grep `AppConfig(`（main.dart 走工厂不受影响；test 手写字面量必须补 `appVersion`/`buildNumber`），漏一处编译即炸。
6. **evaluateJavascript 注入串**：event 与 payload 都必须 `jsonEncode`（直接字符串拼接会在引号/中文处截断）；注入前 `window.__JSB_BRIDGE__` 存在性判断是模板的一部分（h5 未挂载/加载失败页上静默 no-op）。
7. **UI 闭包的 mounted 守卫**：webview 页销毁后 JS 侧迟到的调用到达时，注入实现判 `mounted` 后 no-op（不抛 NATIVE_ERROR——页面销毁不是错误）。
8. **showLoading 幂等**：`_loadingVisible` 标志位是唯一事实源；重复 showLoading 不叠对话框，hideLoading 无实例时 no-op（U4 与 §5.9 第 9 条）。
9. **h5 不用包级 callNative 代理**：getJSB 未 setup 时同步抛（阶段 1 I4 锁定语义）；页面一律持 `handle.runtime` 引用（§7.6 第 6 条）。
10. **h5 StrictMode 双挂载**：useEffect cleanup 必须 `dispose()`（删 window 键 + resetJSB），否则第二次挂载后 `__JSB_BRIDGE__` 指向已释放 runtime 的隐患（S3/S4 覆盖）。
11. **vitest 环境拆分**：SSR 分支用例必须独立文件 + `// @vitest-environment node` docblock（docblock 是文件级），jsdom 文件里 stub window 的写法不可用于“无 window”断言。
12. **openPage 白名单是 native 兜底**：h5 卡片只是演示；真正的访问控制在 `jsb_methods/page.dart`（计划 §6 风险缓解），P2 用例不许删。
13. **注释/文案语言**：Dart 侧注释与 JSBException message、h5 页面文案全中文（§5.5/§5.9/§7.3 逐字锁定）；commit message 遵循 Conventional Commits（如 `feat(mobile): ...` / `feat(h5): ...`）。
14. **不回填执行记录**：docs/hybrid-capability-plan.md §8 由 planner 在阶段门禁统一回填，执行者不改该文件。
