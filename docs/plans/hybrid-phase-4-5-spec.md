# 阶段 4 / 阶段 5 施工方案：mobile 公共能力 A + miniapp 公共能力

> 对应 docs/hybrid-capability-plan.md 阶段 4（任务卡 4.1 / 4.2 / 4.3）与阶段 5（任务卡 5.1–5.5），
> 决策 8（更新检查）、10（权限，本阶段不涉及实现仅保持语义）、11（曝光语义）、12（阶段排序与边界）。
> 本文件是给 coding-agent 的完整施工方案：**所有架构决策已做完，执行者不得自行变更 API 形态、文件结构、命名、文案、依赖版本。**
> 目标分支：`refactor/big-infra`。完成后按 §9 验收命令自查。
> 格式与纪律沿用 [hybrid-phase-1-spec.md](hybrid-phase-1-spec.md)。

---

## 1. 范围与边界

**阶段 4 做**（apps/mobile，Flutter）：

- 4.1 通用四态组件 `PageStateView` + `features/home` 收敛复用。
- 4.2 请求日志拦截器（dev 全量 / prod 仅 ERROR）+ `dioCall` 取消归一（可选 `CancelToken` 挂点）。
- 4.3 `NetworkStatusService`（connectivity_plus）+ `AppLifecycleService`（前后台 → `EventTracker` + flush 挂点）+ 装配接线。

**阶段 5 做**（apps/miniapp，Taro 4 + React 18）：

- 5.1 `ErrorBoundary`（componentDidCatch → core/monitor）+ `app.tsx` 根包裹。
- 5.2 `PageState` 四态组件（补 empty 态）。
- 5.3 `TrackEventType` 增 `expose` + `expose-logic` 纯函数 + `useExpose` hook + `ExposeView` 组件。
- 5.4 `core/update`（wx.getUpdateManager，host 注入，dev 跳过）+ `useNetworkStatus` + `app.tsx` 接线（onNetworkStatusChange / onShow 刷新网络缓存 / onHide 显式 flush）。
- 5.5 `client.ts` 增强：RequestTask abort 取消、dev 请求日志、单请求超时覆盖规范化、token 注入挂点注释（**只写注释，不实现鉴权**，决策 1）。

**不做**（明确排除）：

- 不实现任何鉴权逻辑（决策 1；mobile 侧不建 TokenStore，miniapp 侧只留注释挂点）。
- 不实现 mobile 更新检查 / Push / 权限 / 媒体 / 曝光探测（阶段 6/7）。
- 不改 `openapi/` 契约、不改 server、不改 `apps/h5`。
- 不回填 `docs/hybrid-capability-plan.md` §8 执行记录（planner 在阶段门禁时回填）。
- miniapp 不新增任何运行时依赖（core 零第三方运行时依赖规则不变）；不新增 jsdom / @testing-library（见 §7.5 决策）。
- mobile 不改 `lib/router/`（`/webview` 路由是阶段 2 的文件所有权）。

---

## 2. 文件所有权与并行冲突控制

阶段 4 与阶段 5 **完全不相交**：阶段 4 只改 `apps/mobile/**`，阶段 5 只改 `apps/miniapp/**`。两卡组可并行，不可能产生 git 冲突。

与并行的阶段 2（mobile webview + JSB）的潜在交点：

| 文件                                     | 阶段 2                    | 阶段 4                                                             | 约定                                                                                                                                                                          |
| ---------------------------------------- | ------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/pubspec.yaml`               | 加 `flutter_inappwebview` | 加 `connectivity_plus`（卡 4.3）                                   | 两处都是**单行追加**，按字母序插入各自位置（`connectivity_plus` 在 `dio` 前，`flutter_inappwebview` 在 `flutter_riverpod` 后）；若 git 仍报冲突，保留双方行即可，禁止删对方行 |
| `apps/mobile/lib/app_providers.dart`     | 不碰                      | 卡 4.2/4.3 改                                                      | 阶段 4 独占；阶段 2 的 JSB 装配一律写在 `features/webview/` 内，不进 app_providers                                                                                            |
| `apps/mobile/lib/router/app_router.dart` | 加 `/webview` 路由        | 不碰                                                               | 阶段 2 独占                                                                                                                                                                   |
| `apps/mobile/lib/main.dart`              | 不碰                      | 不碰                                                               | 本阶段不动（生命周期接线放 `app.dart`，见 §4.3）                                                                                                                              |
| `apps/mobile/AGENTS.md`                  | 不碰                      | 卡 4.3 做一次**有界编辑**（仅 §2 例外清单追加两行登记，见 §4.3.4） | 阶段 8 再做护栏增补；两处编辑区域不同段落，不冲突                                                                                                                             |

阶段 5 独占 `apps/miniapp/**` 全部改动，无并行方。

---

## 3. 仓库既有约定（已核查，照此执行）

### mobile（apps/mobile）

| 项       | 取值                                                                                                         | 出处                                           |
| -------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| 包名     | `cms_mobile`（import 前缀 `package:cms_mobile/`）                                                            | pubspec.yaml                                   |
| 状态管理 | `flutter_riverpod ^3.4.3`（AsyncNotifier 三态）                                                              | pubspec.yaml、home_providers.dart              |
| 网络     | `dio ^5.11.1`；`buildDio` 唯一构造入口；`dioCall` 唯一调用边界；业务只 catch `AppError`                      | core/network/dio_client.dart、AGENTS.md §3     |
| 错误模型 | `AppError{code,message,logID?}`；通用文案常量集中在 envelope_interceptor.dart                                | core/error/app_error.dart                      |
| 日志     | `AppLogger` 抽象 + `ConsoleLogger`（ERROR 级自动挂 ErrorReporter）；禁 print/debugPrint（test 除外）         | core/logging/                                  |
| 埋点     | `EventTracker{pageView,track}`；事件名 `资源.动作` 蛇形                                                      | core/analytics/                                |
| 装配     | `app_providers.dart` Provider + main.dart overrides；测试经 ProviderScope overrides 注入替身                 | app_providers.dart、test/helpers/pump_app.dart |
| 配置     | `AppConfig.fromDartDefines()` 唯一读取口；`Flavor{dev,staging,prod}`                                         | core/config/app_config.dart                    |
| 测试     | flutter_test；单测 `test/unit/`、widget `test/widget/`；`_FakeAdapter implements HttpClientAdapter` 打网络桩 | test/                                          |
| 依赖纪律 | pubspec.yaml 单点、`^x.y.z` 形式、新增依赖一次钉定 + 评审；pubspec.lock 不入库                               | AGENTS.md §7                                   |

### miniapp（apps/miniapp）

| 项                                              | 取值                                                                                                                                                                                                                                                                                    | 出处                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 包名                                            | `@monorepo-template/miniapp`（**验收命令的 `--filter` 以此为准**；任务书里写的 `cms-miniapp` 是简称，pnpm 里不存在）                                                                                                                                                                    | package.json                             |
| React                                           | `react ^18.3.1` + `react-dom ^18.3.1`；Taro `^4.2.1`                                                                                                                                                                                                                                    | package.json                             |
| 测试                                            | vitest ^5 node 环境，`tests/**/*.test.{ts,tsx}`；**无 jsdom、无 @testing-library、无 react-test-renderer**；覆盖率门槛 core ≥90 / 整体 ≥70                                                                                                                                              | vitest.config.ts、package.json           |
| core 纪律                                       | `src/core/**` 零第三方运行时依赖（eslint `no-restricted-imports` 固化，只允许相对路径导入）；宿主能力经 globalThis + 注入 fake                                                                                                                                                          | eslint.config.js、core/transport/sink.ts |
| 配置                                            | `src/config/` 唯一入口；`appEnv: "dev" \| "test" \| "prod"`（NODE_ENV 映射）                                                                                                                                                                                                            | src/config/index.ts、types.ts            |
| 组件惯例                                        | 组件文件 PascalCase（`Skeleton.tsx`），纯逻辑文件 kebab（`skeleton-logic.ts`），逻辑抽出纯函数供 node 单测                                                                                                                                                                              | src/component/                           |
| hooks 惯例                                      | camelCase 文件（`usePageTrack.ts`）；hook 薄壳不单测，决策逻辑抽纯函数测                                                                                                                                                                                                                | src/hooks/                               |
| 埋点                                            | `track(name, props)` / `pageView(path)`；事件名 `资源.动作`；`flushTrack()` 已导出                                                                                                                                                                                                      | core/track/index.ts                      |
| 监控                                            | `captureError/captureMessage/flushMonitor`；kind 联合 `js_error/api_error/unhandled_rejection/page_not_found`                                                                                                                                                                           | core/monitor/index.ts                    |
| 网络                                            | `customInstance<T>(config)` 唯一入口，直桥 `Taro.request`；超时 10s；幂等 GET 重试 1 次；失败挂 monitor `api_error`                                                                                                                                                                     | src/api/client.ts                        |
| Taro 运行时 API（已在 node_modules 类型中核实） | `Taro.onAppShow/onAppHide/offAppShow/offAppHide`、`Taro.onNetworkStatusChange/offNetworkStatusChange`、`Taro.getUpdateManager`、`Taro.createIntersectionObserver` 均有类型导出；**App 级 hook 只有 useLaunch/useError/useUnhandledRejection/usePageNotFound，无 useAppShow/useAppHide** | node_modules/@tarojs/taro/types/         |

**命名决策（不留发挥）**：miniapp 侧新文件按仓库惯例而非计划文档字面——组件用 `ErrorBoundary.tsx` / `PageState.tsx` / `ExposeView.tsx`（PascalCase，对齐 Skeleton/SafeImage），hook 用 `useExpose.ts` / `useNetworkStatus.ts`（camelCase，对齐 usePageTrack），纯逻辑用 `*-logic.ts`（kebab，对齐 skeleton-logic）。计划文档 §4 树中的 kebab 组件名以本方案为准。

---

## 4. 阶段 4：mobile 公共能力 A（apps/mobile）

### 4.1 卡 4.1：PageStateView 四态组件 + home 收敛

#### 文件清单

| 动作 | 文件                                                                     |
| ---- | ------------------------------------------------------------------------ |
| 新增 | `lib/core/ui/page_state.dart`                                            |
| 新增 | `test/widget/page_state_view_test.dart`                                  |
| 修改 | `lib/features/home/home_page.dart`（改用 PageStateView，行为与文案不变） |

`test/widget/home_page_test.dart` **不改**：现有断言（`textContaining('加载失败')`、`text('重试')`、三态渲染）必须在重构后原样通过，作为回归护栏。

#### API 契约（逐字实现）

```dart
// lib/core/ui/page_state.dart
import 'package:flutter/material.dart';

/// 页面四态:loading(加载中)/ empty(空数据)/ error(失败可重试)/ success(内容)。
enum PageStatus { loading, empty, error, success }

/// 默认空态文案。
const String kDefaultEmptyMessage = '暂无数据';

/// 默认失败文案。
const String kDefaultErrorMessage = '加载失败';

/// 重试按钮文案。
const String kRetryLabel = '重试';

/// 四态判定纯函数:优先级 loading > error > empty > success。
/// (加载中覆盖一切;失败优先于空态——失败重试入口不能被空态吞掉。)
PageStatus resolvePageStatus({
  required bool isLoading,
  required bool hasError,
  required bool isEmpty,
}) {
  if (isLoading) return PageStatus.loading;
  if (hasError) return PageStatus.error;
  if (isEmpty) return PageStatus.empty;
  return PageStatus.success;
}

/// 通用页面状态视图:四态渲染 + 可选重试入口。
/// 页面只负责把业务状态映射成 PageStatus(经 resolvePageStatus),视图不含业务逻辑。
class PageStateView extends StatelessWidget {
  const PageStateView({
    super.key,
    required this.status,
    this.emptyMessage = kDefaultEmptyMessage,
    this.errorMessage,
    this.onRetry,
    this.child = const SizedBox.shrink(),
  });

  /// 当前状态(必填)。
  final PageStatus status;

  /// 空态文案;null/纯空白回退 [kDefaultEmptyMessage]。
  final String emptyMessage;

  /// 失败文案;null/纯空白回退 [kDefaultErrorMessage]。
  final String? errorMessage;

  /// 重试回调;null = error 态不渲染重试按钮。
  final VoidCallback? onRetry;

  /// success 态内容。
  final Widget child;

  @override
  Widget build(BuildContext context) {
    switch (status) {
      case PageStatus.loading:
        return const Center(
          key: ValueKey<String>('page-state.loading'),
          child: CircularProgressIndicator(),
        );
      case PageStatus.empty:
        return Center(
          key: const ValueKey<String>('page-state.empty'),
          child: Text(_normalize(emptyMessage, kDefaultEmptyMessage)),
        );
      case PageStatus.error:
        return Center(
          key: const ValueKey<String>('page-state.error'),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_normalize(errorMessage, kDefaultErrorMessage)),
              if (onRetry != null) ...[
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  key: const ValueKey<String>('page-state.retry'),
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh),
                  label: const Text(kRetryLabel),
                ),
              ],
            ],
          ),
        );
      case PageStatus.success:
        return KeyedSubtree(
          key: const ValueKey<String>('page-state.success'),
          child: child,
        );
    }
  }

  static String _normalize(String? value, String fallback) {
    final v = value?.trim();
    return v == null || v.isEmpty ? fallback : v;
  }
}
```

#### home_page.dart 重构（行为等价）

```dart
// lib/features/home/home_page.dart(重构后形态;import 略,照现有风格)
import 'package:cms_mobile/core/ui/page_state.dart';
// ...
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ping = ref.watch(pingProvider);
    final error = ping.hasError ? ping.error : null;

    return Scaffold(
      appBar: AppBar(title: const Text('CMS Mobile')),
      body: Center(
        child: PageStateView(
          status: resolvePageStatus(
            isLoading: ping is AsyncLoading,
            hasError: ping.hasError,
            isEmpty: false, // ping 消息串无空态语义,空串按成功渲染(保持现状)
          ),
          errorMessage: error == null ? null : '加载失败:$error',
          onRetry: () => ref.read(pingProvider.notifier).retry(),
          child: switch (ping) {
            AsyncValue(:final value?) => Text(
                value,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            _ => const SizedBox.shrink(),
          },
        ),
      ),
    );
  }
```

注意：`AsyncValue` 的 import 来自 `flutter_riverpod`；`ping is AsyncLoading` 需要 riverpod 类型在作用域内（原有 import 已覆盖）。`'加载失败:$error'` 与现状逐字一致（半角冒号），保证现有 widget 测试不断言失败。

#### 测试用例表（test/widget/page_state_view_test.dart）

包装器：直接 `MaterialApp(theme: AppTheme.light(), home: Scaffold(body: PageStateView(...)))`，无需 ProviderScope（组件不读 Provider）。

| #   | 用例                               | 断言                                                                                          | 边界类       |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------- | ------------ |
| PS1 | resolvePageStatus 优先级           | (true,true,true)→loading；(false,true,true)→error；(false,false,true)→empty；全 false→success | 非法状态迁移 |
| PS2 | loading 态                         | `find.byKey(ValueKey('page-state.loading'))` 一个；含 CircularProgressIndicator；不渲染 child | —            |
| PS3 | empty 态默认文案（空值）           | 不传 emptyMessage → 渲染 `暂无数据`                                                           | 空值         |
| PS4 | empty/error 文案纯空白回退（空值） | `emptyMessage: '  '` → 仍 `暂无数据`；`errorMessage: ' '` → `加载失败`                        | 空值         |
| PS5 | error 态 + 重试                    | 自定义 errorMessage 原样渲染；点 `page-state.retry` 回调被调 1 次                             | —            |
| PS6 | error 态无 onRetry（空值）         | 不渲染 `page-state.retry`，错误文案仍在                                                       | 空值         |
| PS7 | success 态                         | `page-state.success` 一个；child 文本可见；不渲染进度/文案/按钮                               | —            |
| PS8 | 四态切换（非法状态迁移）           | 同一 tester 依次 pumpWidget 四态，断言旧态 key 消失、新态 key 出现                            | 非法状态迁移 |

验收：PS1–PS8 + 既有 `home_page_test.dart` 4 例全绿（待 Flutter 环境执行）。

---

### 4.2 卡 4.2：请求日志拦截器 + dioCall 取消

#### 文件清单

| 动作 | 文件                                                                                      |
| ---- | ----------------------------------------------------------------------------------------- |
| 新增 | `lib/core/network/request_log_interceptor.dart`                                           |
| 新增 | `test/unit/network_request_log_interceptor_test.dart`                                     |
| 修改 | `lib/core/network/dio_client.dart`（dioCall 增加可选 `cancelToken` + 取消归一；两个常量） |
| 修改 | `lib/app_providers.dart`（dioProvider 装配 RequestLogInterceptor）                        |

#### 4.2.1 RequestLogInterceptor API 契约

```dart
// lib/core/network/request_log_interceptor.dart
import 'package:dio/dio.dart';

import 'package:cms_mobile/core/logging/app_logger.dart';

/// 请求起始时间戳在 RequestOptions.extra 上的键。
const String kRequestLogStartMsKey = 'cms.requestLog.startMs';

/// 请求日志拦截器:verbose(dev/staging)记全量 debug 日志;非 verbose(prod)只记错误。
/// 装配在信封拦截器之后(buildDio additionalInterceptors),onError 看到的已是归一后的 AppError。
class RequestLogInterceptor extends Interceptor {
  const RequestLogInterceptor({required this.logger, required this.verbose});

  final AppLogger logger;

  /// true = 记请求/响应 debug 日志;false = 只记 error。
  final bool verbose;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.extra[kRequestLogStartMsKey] = DateTime.now().millisecondsSinceEpoch;
    if (verbose) {
      logger.debug('HTTP 请求', context: <String, Object?>{
        'method': options.method,
        'url': options.uri.toString(),
      });
    }
    handler.next(options);
  }

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    if (verbose) {
      logger.debug('HTTP 响应', context: _contextOf(response.requestOptions)
        ..['statusCode'] = response.statusCode ?? 0);
    }
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    logger.error(
      'HTTP 请求失败',
      error: err.error ?? err,
      context: _contextOf(err.requestOptions)
        ..['statusCode'] = err.response?.statusCode ?? 0,
    );
    handler.next(err);
  }

  Map<String, Object?> _contextOf(RequestOptions options) {
    final context = <String, Object?>{
      'method': options.method,
      'url': options.uri.toString(),
    };
    final startMs = options.extra[kRequestLogStartMsKey];
    if (startMs is int) {
      context['durationMs'] = DateTime.now().millisecondsSinceEpoch - startMs;
    }
    return context;
  }
}
```

行为锁定：

- 三条日志文案固定为 `HTTP 请求` / `HTTP 响应` / `HTTP 请求失败`（中文，不留发挥）。
- context 键固定：`method` / `url` / `statusCode` / `durationMs`（无起点标记时 `durationMs` 键不出现）。
- 任何分支都必须把 `handler.next(...)` 调到底——拦截器永不阻断管道（含 verbose=false）。
- onError 的 error 入参：优先 `err.error`（信封拦截器已归一为 AppError），缺失时传 DioException 本体。

#### 4.2.2 dioCall 取消契约（dio_client.dart 修改）

文件头注释区新增常量，`dioCall` 签名扩展（存量调用零改动）：

```dart
/// 取消错误的业务码:与网络失败(code 0)区分,供调用方静默吞掉。
const int kCancelledErrorCode = -1;

/// 取消错误的统一文案。
const String kRequestCancelledMessage = '请求已取消';

Future<Response<T>> dioCall<T>(
  Future<Response<T>> Function() send, {
  CancelToken? cancelToken,
}) async {
  try {
    return await send();
  } on DioException catch (e) {
    // 取消归一:先于 AppError 解包判定——信封拦截器会把取消也包成网络失败,
    // 这里按 type / token 状态还原为取消语义。
    if (e.type == DioExceptionType.cancel || (cancelToken?.isCancelled ?? false)) {
      throw const AppError(code: kCancelledErrorCode, message: kRequestCancelledMessage);
    }
    final Object? error = e.error;
    if (error is AppError) {
      throw error;
    }
    throw const AppError(code: 0, message: kNetworkErrorMessage);
  }
}
```

语义锁定：

- 实际取消动作由调用方把同一个 `CancelToken` 传给 dio 请求（`_dio.get(path, cancelToken: token)`）；`dioCall` 的 `cancelToken` 参数只做**归一判定**（覆盖 dio 未以 cancel 类型冒出的边角），不负责触发取消。
- 取消统一抛 `AppError(code: -1, message: '请求已取消')`；重试拦截器本就不重试 cancel（retry_interceptor.dart 现状），无需改动。
- 存量不传参调用行为唯一变化：取消从「网络连接失败」改判为「请求已取消」（语义修正，属本卡目标）。
- 需要 CancelToken import：dio_client.dart 顶部 `import 'package:dio/dio.dart';` 已存在，CancelToken 同包导出，无需新 import。

#### 4.2.3 app_providers.dart 修改（dioProvider）

```dart
/// Dio 实例:全应用共享(信封/重试拦截器已在 buildDio 装配;请求日志拦截器追加在信封之后)。
final dioProvider = Provider((ref) {
  final config = ref.watch(appConfigProvider);
  return buildDio(
    config,
    additionalInterceptors: <Interceptor>[
      RequestLogInterceptor(
        logger: ref.watch(appLoggerProvider),
        // dev/staging 全量 debug;prod 只记错误(见 RequestLogInterceptor)。
        verbose: config.flavor != Flavor.prod,
      ),
    ],
  );
});
```

需要新增 import：`core/logging/app_logger.dart` 已有（经 appLoggerProvider 间接）——`Flavor` 来自已 import 的 `core/config/app_config.dart`；`RequestLogInterceptor` 新增 import `core/network/request_log_interceptor.dart`；`Interceptor` 类型需要 `package:dio/dio.dart` import（app_providers 此前未 import dio，本卡新增——dio 属于网络层装配，装配层允许）。

#### 测试用例表

**test/unit/network_request_log_interceptor_test.dart**（FakeAppLogger 实现 AppLogger 四方法记录调用；直接调 interceptor 的 onRequest/onResponse/onError，handler 用 `InterceptorsWrapper` 风格的最小 fake——锁定用 `RequestInterceptorHandler()` / `ResponseInterceptorHandler()` / `ErrorInterceptorHandler()` 的真实构造 + spy 包装过于繁琐，采用惯例：自定义 `_SpyRequestHandler implements RequestInterceptorHandler` 记录 next 调用）。

| #   | 用例               | 断言                                                                                                         | 边界类                       |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| RL1 | verbose 全量       | onRequest → debug('HTTP 请求', {method,url})；onResponse → debug('HTTP 响应', 含 statusCode 与 durationMs≥0) | —                            |
| RL2 | prod 静默          | verbose=false：onRequest/onResponse 零日志                                                                   | 权限缺失（等价：无输出权限） |
| RL3 | 错误必记           | verbose 任意：onError → error('HTTP 请求失败')，error 透传 AppError 本体，context 含 method/url/statusCode   | 网络失败                     |
| RL4 | 无起点标记（空值） | 直接 onResponse（未过 onRequest）→ context 无 `durationMs` 键，不抛                                          | 空值                         |
| RL5 | 管道不阻断         | 三方法均调用对应 handler.next 恰好 1 次                                                                      | 非法状态迁移                 |
| RL6 | dioCall 取消归一   | send 抛 `DioException(type: cancel, error: AppError(code:0,...))` → 抛 AppError(-1, '请求已取消')            | 网络失败                     |
| RL7 | dioCall token 判定 | send 抛非 cancel 类型 DioException，但传入已 cancelled 的 CancelToken → AppError(-1)                         | 非法状态迁移                 |
| RL8 | dioCall 存量回归   | dio_client_test.dart 现有 3 组用例不改不动、全绿（成功透传 / AppError 解包 / 裸错误兜底网络失败）            | 网络失败                     |

---

### 4.3 卡 4.3：网络状态 + 生命周期 + 装配

#### 文件清单

| 动作 | 文件                                                                     |
| ---- | ------------------------------------------------------------------------ |
| 新增 | `lib/core/network/network_status.dart`                                   |
| 新增 | `lib/core/lifecycle/app_lifecycle.dart`                                  |
| 新增 | `test/unit/network_status_test.dart`                                     |
| 新增 | `test/unit/app_lifecycle_test.dart`                                      |
| 修改 | `pubspec.yaml`（加 connectivity_plus，单行）                             |
| 修改 | `lib/app_providers.dart`（新增两个 Provider）                            |
| 修改 | `lib/app.dart`（CmsMobileApp 改 ConsumerStatefulWidget，initState 接线） |
| 修改 | `apps/mobile/AGENTS.md`（§2 例外清单追加两行，有界编辑）                 |

#### 4.3.1 依赖（钉版本待评审）

pubspec.yaml `dependencies:` 段、`dio: ^5.11.1` **之前**按字母序插入一行：

```yaml
connectivity_plus: ^6.1.4
```

- connectivity_plus 6.x 为当前稳定大版本（v6 起 `checkConnectivity()` 返回 `List<ConnectivityResult>`、流同型），选 6.1 小版本线；本机无 Flutter SDK 无法解析 lock，**钉版本待评审**：首个有 Flutter 环境的执行者跑 `flutter pub get` 后把解析到的精确版本回填进执行记录，若 6.1.4 不存在则取 6.1.x 最新并在评审记录中说明。
- 禁止顺手升级其它依赖。

#### 4.3.2 network_status.dart API 契约

```dart
// lib/core/network/network_status.dart
import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

/// 网络状态三态:unknown = 尚未取得或读取失败(初始值)。
enum NetworkStatus { online, offline, unknown }

/// connectivity_plus v6 结果(链路列表)→ 三态;纯函数便于单测。
/// 空列表或全部为 none → offline;存在任一真实链路 → online。
NetworkStatus mapConnectivityResults(List<ConnectivityResult> results) {
  if (results.isEmpty) return NetworkStatus.offline;
  final hasLink = results.any((r) => r != ConnectivityResult.none);
  return hasLink ? NetworkStatus.online : NetworkStatus.offline;
}

/// 状态源抽象:生产实现桥接 connectivity_plus,单测注入 fake。
abstract interface class NetworkStatusSource {
  Future<NetworkStatus> current();
  Stream<NetworkStatus> get onChange;
}

/// connectivity_plus 桥接实现(插件薄壳,单测不触)。
class ConnectivityNetworkStatusSource implements NetworkStatusSource {
  ConnectivityNetworkStatusSource([Connectivity? connectivity])
      : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;

  @override
  Future<NetworkStatus> current() async =>
      mapConnectivityResults(await _connectivity.checkConnectivity());

  @override
  Stream<NetworkStatus> get onChange =>
      _connectivity.onConnectivityChanged.map(mapConnectivityResults);
}

/// 网络状态服务:首值 unknown;start() 开始订阅,refresh() 主动拉一次。
/// 读取失败保持旧值不抛错(状态感知是辅助能力,永不阻塞主流程)。
/// stream 只发「值变化」(广播,不回放;消费方先读 current 再听 stream)。
class NetworkStatusService {
  NetworkStatusService({required NetworkStatusSource source}) : _source = source;

  final NetworkStatusSource _source;
  final StreamController<NetworkStatus> _controller =
      StreamController<NetworkStatus>.broadcast();

  NetworkStatus _current = NetworkStatus.unknown;
  StreamSubscription<NetworkStatus>? _subscription;
  bool _started = false;
  bool _disposed = false;

  NetworkStatus get current => _current;
  Stream<NetworkStatus> get stream => _controller.stream;

  /// 开始订阅状态源;重复调用幂等。
  void start() {
    if (_started || _disposed) return;
    _started = true;
    _subscription = _source.onChange.listen(_apply);
  }

  /// 主动刷新一次;源读取失败保持旧值(吞错)。
  Future<void> refresh() async {
    if (_disposed) return;
    try {
      _apply(await _source.current());
    } catch (_) {
      // 读取失败保持旧值,不阻塞调用方
    }
  }

  /// 值去重应用:同值不重复广播(非法状态迁移护栏)。
  void _apply(NetworkStatus next) {
    if (_disposed || next == _current) return;
    _current = next;
    _controller.add(next);
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _subscription?.cancel();
    await _controller.close();
  }
}
```

#### 4.3.3 app_lifecycle.dart API 契约

```dart
// lib/core/lifecycle/app_lifecycle.dart
import 'package:flutter/widgets.dart';

import 'package:cms_mobile/core/analytics/event_tracker.dart';
import 'package:cms_mobile/core/logging/app_logger.dart';

/// 前后台埋点事件名(与 miniapp/全端命名对齐:资源.动作 蛇形)。
const String kAppForegroundEvent = 'app.foreground';
const String kAppBackgroundEvent = 'app.background';

/// 生命周期状态 → 事件名;中间态(inactive/hidden/detached)不产生事件,返回 null。
/// 纯函数便于单测。
String? lifecycleEventFor(AppLifecycleState state) {
  switch (state) {
    case AppLifecycleState.resumed:
      return kAppForegroundEvent;
    case AppLifecycleState.paused:
      return kAppBackgroundEvent;
    case AppLifecycleState.inactive:
    case AppLifecycleState.hidden:
    case AppLifecycleState.detached:
      return null;
  }
}

/// 应用生命周期接线:监听 WidgetsBinding 前后台切换,经 EventTracker 上报
/// app.foreground / app.background;进入后台时调用 onBackground flush 挂点
/// (同步钩子,挂点供后续阶段的 flush 实现使用;本阶段可传 null)。
/// 同态去重:连续两个相同事件只报一次(防御平台重复回调)。
class AppLifecycleService extends WidgetsBindingObserver {
  AppLifecycleService({
    required EventTracker tracker,
    void Function()? onBackground,
    AppLogger? logger,
  })  : _tracker = tracker,
        _onBackground = onBackground,
        _logger = logger;

  final EventTracker _tracker;
  final void Function()? _onBackground;
  final AppLogger? _logger;

  String? _lastEvent;
  bool _started = false;

  /// 注册 WidgetsBinding 观察;重复调用幂等。
  void start() {
    if (_started) return;
    _started = true;
    WidgetsBinding.instance.addObserver(this);
  }

  /// 反注册;未 start 时 no-op。
  void dispose() {
    if (!_started) return;
    _started = false;
    WidgetsBinding.instance.removeObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) => handle(state);

  /// 状态入口:WidgetsBinding 回调与单测共用。
  void handle(AppLifecycleState state) {
    final event = lifecycleEventFor(state);
    if (event == null || event == _lastEvent) return;
    _lastEvent = event;
    _tracker.track(event);
    if (event == kAppBackgroundEvent) {
      final hook = _onBackground;
      if (hook != null) {
        try {
          hook();
        } catch (error) {
          _logger?.warn('应用切后台 flush 钩子执行失败', error: error);
        }
      }
    }
  }
}
```

#### 4.3.4 app_providers.dart / app.dart / AGENTS.md 接线

app_providers.dart 追加（import 相应补 `core/network/network_status.dart`、`core/lifecycle/app_lifecycle.dart`、`dart:async` 的 unawaited）：

```dart
/// 网络状态:全局单例服务;app.dart initState 启动(start + 首次 refresh)。
/// 测试经 override 注入 fake source 的 service。
final networkStatusServiceProvider = Provider<NetworkStatusService>((ref) {
  final service = NetworkStatusService(source: ConnectivityNetworkStatusSource());
  ref.onDispose(() => unawaited(service.dispose()));
  return service;
});

/// 生命周期接线:前后台事件 → EventTracker;flush 挂点本阶段留空(null)。
final appLifecycleServiceProvider = Provider<AppLifecycleService>((ref) {
  final service = AppLifecycleService(
    tracker: ref.watch(eventTrackerProvider),
    logger: ref.watch(appLoggerProvider),
  );
  ref.onDispose(service.dispose);
  return service;
});
```

app.dart：`CmsMobileApp` 由 ConsumerWidget 改为 ConsumerStatefulWidget，build 内容不变，新增 initState：

```dart
class CmsMobileApp extends ConsumerStatefulWidget {
  const CmsMobileApp({super.key});

  @override
  ConsumerState<CmsMobileApp> createState() => _CmsMobileAppState();
}

class _CmsMobileAppState extends ConsumerState<CmsMobileApp> {
  @override
  void initState() {
    super.initState();
    // 生命周期与网络状态接线(阶段 4.3):服务实例来自装配层,启动幂等。
    ref.read(appLifecycleServiceProvider).start();
    final network = ref.read(networkStatusServiceProvider)
      ..start();
    unawaited(network.refresh());
  }

  @override
  Widget build(BuildContext context) {
    // 原有 build 体逐行保留(ref.watch(appLoggerProvider)/ref.watch(pingProvider)/MaterialApp.router...)
  }
}
```

（app.dart 需新增 `import 'dart:async';`；dispose 由 Provider 的 onDispose 承担，State.dispose 不再重复调。）

apps/mobile/AGENTS.md §2 有界编辑——在「仅两类已登记例外」一句的括号内追加登记（改动仅限该括号内文字）：

> 仅两类已登记例外：`config`（人人可用）与 `error`（`network` 以 `AppError` 为唯一错误模型、`logging` 的 ERROR 级挂接 `ErrorReporter` 是接口契约）；另登记（阶段 4）：`network → logging`（请求日志拦截器复用 AppLogger）、`lifecycle → analytics`（前后台事件埋点）与 `lifecycle → logging`（flush 钩子失败告警，可选依赖）

#### 测试用例表

**test/unit/network_status_test.dart**（fake source 实现 NetworkStatusSource；Stream 用 `StreamController<NetworkStatus>` 手动喂）：

| #   | 用例                             | 断言                                                                                                                                                 | 边界类       |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| NS1 | mapConnectivityResults 映射      | `[]`→offline（空值）；`[none]`→offline；`[wifi]`→online；`[none, mobile]`→online；`[bluetooth]`→online                                               | 空值/零值    |
| NS2 | 初始态（零值）                   | 新 service.current == unknown；stream 未发事件                                                                                                       | 零值         |
| NS3 | start 订阅 + 去重                | fake 流依次喂 offline→offline→online：stream 收到 [offline, online]（重复 offline 只一次）；current 同步                                             | 非法状态迁移 |
| NS4 | refresh 成功                     | fake current()=online → current 变 online 且广播一次                                                                                                 | —            |
| NS5 | refresh 失败保持旧值（网络失败） | 先 refresh 成功得 online；fake current() 改为抛错 → refresh 不抛、current 仍 online、无新广播                                                        | 网络失败     |
| NS6 | dispose 后静默（非法状态迁移）   | dispose 后再喂流/refresh：无广播、current 不变、不抛                                                                                                 | 非法状态迁移 |
| NS7 | start 幂等                       | start() 两次，fake 流只被 listen 一次                                                                                                                | 非法状态迁移 |
| NS8 | 装配不破坏现有覆盖               | ProviderScope overrides `networkStatusServiceProvider.overrideWithValue(fakeService)` 可注入；既有 pump_app/home_page 测试不受影响（不改文件即回归） | —            |

**test/unit/app_lifecycle_test.dart**（`TestWidgetsFlutterBinding.ensureInitialized()`；FakeEventTracker 记录 track 调用）：

| #   | 用例                         | 断言                                                                                               | 边界类       |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------------- | ------------ |
| LC1 | lifecycleEventFor 映射       | resumed→app.foreground；paused→app.background；inactive/hidden/detached→null（空值）               | 空值         |
| LC2 | 事件序列                     | handle(resumed→paused→resumed) → tracker 依次收到 [app.foreground, app.background, app.foreground] | —            |
| LC3 | 同态去重（非法状态迁移）     | handle(paused→paused) → app.background 只报一次                                                    | 非法状态迁移 |
| LC4 | 中间态不产生事件             | handle(inactive) → tracker 零调用                                                                  | 空值         |
| LC5 | flush 挂点                   | onBackground spy：进入 paused 时被调 1 次；进入 resumed 不调；传 null 时流程不抛                   | 空值         |
| LC6 | 挂点抛错吞掉（网络失败等价） | onBackground 抛 StateError + 注入 FakeLogger → handle 不抛、logger.warn 一次、事件仍已上报         | 网络失败     |
| LC7 | start/dispose 幂等           | start×2 + dispose×2 不抛；dispose 后 handle 仍可用（纯逻辑路径不受注册态影响）                     | 非法状态迁移 |

---

## 5. 阶段 5：miniapp 公共能力（apps/miniapp）

### 5.1 卡 5.1：ErrorBoundary + app.tsx 根包裹

#### 文件清单

| 动作 | 文件                                    |
| ---- | --------------------------------------- |
| 新增 | `src/component/error-boundary-logic.ts` |
| 新增 | `src/component/ErrorBoundary.tsx`       |
| 新增 | `tests/error-boundary.test.ts`          |
| 修改 | `src/app.tsx`（ErrorBoundary 根包裹）   |

#### 5.1.1 error-boundary-logic.ts 契约

```ts
// src/component/error-boundary-logic.ts
// ErrorBoundary 纯逻辑:渲染异常 → MonitorPayload 归一(永不抛错)。
import type { MonitorPayload } from "../core/monitor";

export interface BoundaryErrorInput {
  error: unknown;
  componentStack?: string;
  extra?: Record<string, unknown>;
}

/** 渲染异常归一为 monitor js_error;message 前缀固定「页面渲染失败: 」。 */
export function normalizeBoundaryError(input: BoundaryErrorInput): MonitorPayload {
  const { error, componentStack, extra } = input;
  let message: string;
  let stack: string | undefined;
  if (error instanceof Error) {
    message = error.message !== "" ? error.message : error.name;
    stack = error.stack;
  } else if (typeof error === "string" && error !== "") {
    message = error;
  } else {
    try {
      message = JSON.stringify(error) ?? "[unknown render error]";
    } catch {
      message = "[unknown render error]";
    }
  }
  const mergedExtra: Record<string, unknown> = { ...(extra ?? {}) };
  if (typeof componentStack === "string" && componentStack !== "") {
    mergedExtra["componentStack"] = componentStack;
  }
  return {
    kind: "js_error",
    message: `页面渲染失败: ${message}`,
    stack,
    extra: mergedExtra
  };
}
```

注意 `mergedExtra["componentStack"]` 用方括号（`noPropertyAccessFromIndexSignature` 对 `Record<string, unknown>` 生效，phase-1 易错点同款）。

#### 5.1.2 ErrorBoundary.tsx 契约

```tsx
// src/component/ErrorBoundary.tsx
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Text, View } from "@tarojs/components";

import { captureError, type MonitorPayload } from "../core/monitor";
import { normalizeBoundaryError } from "./error-boundary-logic";

export interface ErrorBoundaryProps {
  children?: ReactNode;
  /** 自定义兜底:静态节点或 (error, reset) 渲染函数;缺省渲染内置中文兜底 */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** 附加上报上下文(如页面标识) */
  extra?: Record<string, unknown>;
  /** 上报注入(单测);缺省 core/monitor captureError */
  onCapture?: (payload: MonitorPayload) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const capture = this.props.onCapture ?? captureError;
    capture(
      normalizeBoundaryError({
        error,
        componentStack: typeof info.componentStack === "string" ? info.componentStack : undefined,
        extra: this.props.extra
      })
    );
  }

  /** 重置回 children(重试入口);幂等。 */
  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children ?? null;
    const { fallback } = this.props;
    if (typeof fallback === "function") return fallback(error, this.reset);
    if (fallback !== undefined && fallback !== null) return fallback;
    return (
      <View className="error-boundary-fallback">
        <Text className="error-boundary-fallback__text">页面出错了,请稍后重试</Text>
        <View className="error-boundary-fallback__retry" onClick={this.reset}>
          重试
        </View>
      </View>
    );
  }
}
```

锁定文案：`页面出错了,请稍后重试` / `重试`。

#### 5.1.3 app.tsx 修改

```tsx
// 新增 import(与文件名大小写逐字一致)
import { ErrorBoundary } from "./component/ErrorBoundary";
```

锁定：import 路径为 `./component/ErrorBoundary`。return 改为：

```tsx
// 渲染异常根兜底(N5.1):子树抛错 → 上报 monitor + 中文兜底页,不白屏
return <ErrorBoundary>{children}</ErrorBoundary>;
```

#### 测试用例表（tests/error-boundary.test.ts）

**测试环境决策**：无 jsdom / @testing-library / react-test-renderer，**禁止新增这些依赖**。测试方式 = 直接 new 类实例 + 结构断言（render() 返回 React element 树，node 环境可断言）；文件顶部 `vi.mock("@tarojs/components", () => ({ View: "View", Text: "Text" }))` 使组件 import 在 node 安全；默认上报路径用 `vi.mock("../src/core/monitor", ...)` spy captureError。

| #    | 用例                                             | 断言                                                                                                                                                                                               | 边界类       |
| ---- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| EB1  | normalizeBoundaryError：Error                    | message `页面渲染失败: boom`；stack 透传；kind js_error                                                                                                                                            | —            |
| EB2  | normalizeBoundaryError：空 message Error（空值） | `new Error("")` → message 用 `error.name`（`页面渲染失败: Error`）                                                                                                                                 | 空值         |
| EB3  | normalizeBoundaryError：非 Error（空值/越界）    | `"oops"` 字符串原样；`null` → `[unknown render error]`；循环引用对象 → `[unknown render error]` 不抛                                                                                               | 空值/越界    |
| EB4  | componentStack 合并                              | 非空串写入 extra.componentStack；空串/undefined 不写该键；props.extra 字段保留                                                                                                                     | 空值         |
| EB5  | getDerivedStateFromError                         | 返回 `{ error }` 同一引用                                                                                                                                                                          | —            |
| EB6  | componentDidCatch 默认路径                       | 未传 onCapture：core/monitor 的 captureError spy 被调 1 次，payload.kind === "js_error"                                                                                                            | —            |
| EB7  | componentDidCatch 注入路径                       | onCapture spy 收到归一 payload，captureError 不被调                                                                                                                                                | —            |
| EB8  | render：无错误                                   | state.error=null → 返回 children 同一引用                                                                                                                                                          | 零值         |
| EB9  | render：函数 fallback                            | 置 `boundary.state = { error }` 后 render() → fallback spy 收到 (error, reset 函数)                                                                                                                | —            |
| EB10 | render：默认兜底结构                             | 返回树含文本 `页面出错了,请稍后重试` 与 `重试`；调重试节点的 onClick → `vi.spyOn(boundary, "setState")` 收到 `{ error: null }`（重置重试语义；未挂载实例 setState 由 spy 断言，不依赖 React 挂载） | 非法状态迁移 |

---

### 5.2 卡 5.2：PageState 四态组件

#### 文件清单

| 动作 | 文件                                |
| ---- | ----------------------------------- |
| 新增 | `src/component/page-state-logic.ts` |
| 新增 | `src/component/PageState.tsx`       |
| 新增 | `tests/page-state.test.ts`          |

#### page-state-logic.ts 契约

```ts
// src/component/page-state-logic.ts

/** 页面四态(对齐 mobile PageStatus)。 */
export type PageStatus = "loading" | "empty" | "error" | "success";

export const PAGE_STATE_DEFAULT_EMPTY_MESSAGE = "暂无数据";
export const PAGE_STATE_DEFAULT_ERROR_MESSAGE = "加载失败,请稍后重试";
export const PAGE_STATE_RETRY_LABEL = "重试";

export interface PageStateCopyInput {
  status: PageStatus;
  errorMessage?: string;
  emptyMessage?: string;
  /** error 态是否有重试入口(组件层由 onRetry 是否存在推导) */
  retryable: boolean;
}

export interface PageStateCopy {
  /** empty/error 态文案;其余态空串 */
  message: string;
  showRetry: boolean;
}

/** 四态文案解析:空串/纯空白回退默认文案;非法 status 兜底为 error 默认文案(不重试)。 */
export function resolvePageStateCopy(input: PageStateCopyInput): PageStateCopy {
  const errorMessage = pickMessage(input.errorMessage, PAGE_STATE_DEFAULT_ERROR_MESSAGE);
  const emptyMessage = pickMessage(input.emptyMessage, PAGE_STATE_DEFAULT_EMPTY_MESSAGE);
  switch (input.status) {
    case "error":
      return { message: errorMessage, showRetry: input.retryable };
    case "empty":
      return { message: emptyMessage, showRetry: false };
    case "loading":
    case "success":
      return { message: "", showRetry: false };
    default:
      // 运行时非法值(强转/JS 调用方):兜底 error 默认文案,不给重试
      return { message: PAGE_STATE_DEFAULT_ERROR_MESSAGE, showRetry: false };
  }
}

function pickMessage(value: string | undefined, fallback: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? fallback : (value as string);
}
```

#### PageState.tsx 契约

```tsx
// src/component/PageState.tsx
import { Text, View } from "@tarojs/components";
import type { ReactNode } from "react";

import { Skeleton } from "./Skeleton";
import { PAGE_STATE_RETRY_LABEL, resolvePageStateCopy, type PageStatus } from "./page-state-logic";

export interface PageStateProps {
  status: PageStatus;
  errorMessage?: string;
  emptyMessage?: string;
  onRetry?: () => void;
  /** success 态内容 */
  children?: ReactNode;
}

export function PageState({
  status,
  errorMessage,
  emptyMessage,
  onRetry,
  children
}: PageStateProps) {
  const copy = resolvePageStateCopy({
    status,
    errorMessage,
    emptyMessage,
    retryable: typeof onRetry === "function"
  });
  if (status === "loading") return <Skeleton />;
  if (status === "empty") {
    return (
      <View className="page-state">
        <Text className="page-state__text">{copy.message}</Text>
      </View>
    );
  }
  if (status === "error") {
    return (
      <View className="page-state">
        <Text className="page-state__text">{copy.message}</Text>
        {copy.showRetry ? (
          <View className="page-state__retry" onClick={onRetry}>
            {PAGE_STATE_RETRY_LABEL}
          </View>
        ) : null}
      </View>
    );
  }
  return <>{children}</>;
}
```

设计决策（锁定）：loading 态复用 `Skeleton`（壳已有骨架屏，不自绘 spinner）；样式类名固定 `page-state` / `page-state__text` / `page-state__retry`。

#### 测试用例表（tests/page-state.test.ts）

组件层用直接函数调用 `PageState({...})` 返回 element 树断言（PageState 无 hooks，安全）；顶部 `vi.mock("@tarojs/components", ...)` 同 5.1。

| #    | 用例                             | 断言                                                                           | 边界类       |
| ---- | -------------------------------- | ------------------------------------------------------------------------------ | ------------ |
| PST1 | 默认文案（空值）                 | error 不传 errorMessage → `加载失败,请稍后重试`；empty 不传 → `暂无数据`       | 空值         |
| PST2 | 纯空白回退（空值）               | `'   '` → 默认文案                                                             | 空值         |
| PST3 | loading/success 文案             | resolvePageStateCopy 返回 message `""`、showRetry false                        | 零值         |
| PST4 | 非法 status 兜底（非法状态迁移） | `status: "bogus" as never` → error 默认文案 + showRetry false                  | 非法状态迁移 |
| PST5 | retryable 派生                   | error + retryable=true → showRetry true；empty + retryable=true → 仍 false     | —            |
| PST6 | 组件：loading 渲染 Skeleton      | `PageState({status:"loading"})` 返回 element.type === Skeleton                 | —            |
| PST7 | 组件：error 重试回调             | 树中重试节点 onClick === 传入的 onRetry；不传 onRetry → 树中无重试节点（空值） | 空值         |
| PST8 | 组件：success 渲染 children      | children 原样出现在返回树                                                      | —            |

---

### 5.3 卡 5.3：曝光埋点（expose 事件 + 纯逻辑 + hook + 组件）

#### 文件清单

| 动作 | 文件                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------- |
| 修改 | `src/core/track/index.ts`（TrackEventType 加 `"expose"`；Tracker 加 `expose`；导出模块级 `expose()`） |
| 新增 | `src/core/track/expose-logic.ts`                                                                      |
| 新增 | `src/hooks/useExpose.ts`                                                                              |
| 新增 | `src/component/ExposeView.tsx`                                                                        |
| 新增 | `tests/expose-logic.test.ts`                                                                          |

#### 5.3.1 core/track/index.ts 修改点

```ts
/** 内建事件类型:page_view(页面曝光)/ click(点击)/ expose(元素曝光)/ custom(自定义) */
export type TrackEventType = "page_view" | "click" | "custom" | "expose";
```

`Tracker` 接口追加：

```ts
  /** 元素曝光:trackId 为埋点位标识;同页面实例去重由调用侧(useExpose/ExposeView)承担 */
  expose(trackId: string, props?: EventProps): void;
```

createTracker 返回对象追加：

```ts
    expose(trackId, props = {}) {
      // 空 trackId 直接丢弃(空值护栏,不产出无归属事件)
      if (typeof trackId !== "string" || trackId.trim() === "") return;
      enqueue("expose", "expose", { trackId, ...props });
    },
```

模块尾部追加业务入口：

```ts
/** 业务入口:元素曝光(事件名 track.expose)。 */
export function expose(trackId: string, props?: EventProps): void {
  tracker.expose(trackId, props);
}
```

事件形态锁定：入队记录 `event: "track.expose"`，`props.name === "expose"`，`props.trackId` 为埋点位标识；公共参数/采样/总开关走既有 `enqueue` 链路（expose 与 track 完全同权）。

#### 5.3.2 expose-logic.ts 契约（core，零第三方依赖，不 import monitor/track——模块独立）

```ts
// src/core/track/expose-logic.ts
// 曝光判定与去重纯逻辑(决策 11):≥50% 可见持续 300ms 触发;页面实例级去重。

/** 可见比例阈值:≥0.5。 */
export const EXPOSE_RATIO_THRESHOLD = 0.5;
/** 持续时长阈值(ms):≥300。 */
export const EXPOSE_DURATION_THRESHOLD_MS = 300;

/** 曝光触发判定:比例与时长双阈值;非有限数一律 false。 */
export function shouldExpose(ratio: number, durationMs: number): boolean {
  return (
    Number.isFinite(ratio) &&
    Number.isFinite(durationMs) &&
    ratio >= EXPOSE_RATIO_THRESHOLD &&
    durationMs >= EXPOSE_DURATION_THRESHOLD_MS
  );
}

/** 页面实例级去重器:同一实例内同 trackId 只放行一次;reset 后可再放行。 */
export interface ExposeDedup {
  /** 首次返回 true 并登记;已登记返回 false */
  tryMark(trackId: string): boolean;
  has(trackId: string): boolean;
  reset(): void;
  /** 已登记条数(诊断/测试用) */
  size(): number;
}

export function createExposeDedup(): ExposeDedup {
  const marked = new Set<string>();
  return {
    tryMark(trackId) {
      if (marked.has(trackId)) return false;
      marked.add(trackId);
      return true;
    },
    has: (trackId) => marked.has(trackId),
    reset: () => marked.clear(),
    size: () => marked.size
  };
}

export interface ExposeSessionOptions {
  trackId: string;
  /** 满足条件时的上报回调(由 hook 接到 core/track 的 expose) */
  report: (trackId: string) => void;
  /** 注入定时器(单测);缺省全局 setTimeout/clearTimeout */
  setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** 持续时长阈值,默认 EXPOSE_DURATION_THRESHOLD_MS */
  durationMs?: number;
}

export interface ExposeSession {
  /** observer 回调喂入当前可见比例(0~1;非法值按 0 处理) */
  onVisible(ratio: number): void;
  /** 释放:清掉待定计时器;之后 onVisible 不再生效 */
  dispose(): void;
}

/**
 * 曝光会话(一个埋点位实例一个 session):
 * hidden →(ratio ≥ 阈值)pending(起计时)→(持续达标)report 一次 → exposed(本会话不再报);
 * pending 中比例跌回阈值下 → 撤计时回 hidden;dispose 幂等。
 */
export function createExposeSession(options: ExposeSessionOptions): ExposeSession {
  const { trackId, report } = options;
  const durationMs = options.durationMs ?? EXPOSE_DURATION_THRESHOLD_MS;
  const setTimeoutFn = options.setTimeoutFn ?? ((h: () => void, ms: number) => setTimeout(h, ms));
  const clearTimeoutFn =
    options.clearTimeoutFn ??
    ((handle: unknown) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));
  const dedup = createExposeDedup();

  let phase: "hidden" | "pending" | "exposed" = "hidden";
  let timer: unknown;
  let disposed = false;

  function cancelTimer(): void {
    if (timer !== undefined) {
      clearTimeoutFn(timer);
      timer = undefined;
    }
  }

  return {
    onVisible(ratio) {
      if (disposed || phase === "exposed") return;
      const visible = Number.isFinite(ratio) && ratio >= EXPOSE_RATIO_THRESHOLD;
      if (!visible) {
        cancelTimer();
        phase = "hidden";
        return;
      }
      if (phase === "pending") return; // 计时已在跑,不重复起表
      phase = "pending";
      timer = setTimeoutFn(() => {
        timer = undefined;
        if (disposed || phase !== "pending") return;
        phase = "exposed";
        if (dedup.tryMark(trackId)) {
          report(trackId);
        }
      }, durationMs);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelTimer();
    }
  };
}
```

去重口径锁定（对决策 11 的落地解释，执行者不得改）：**dedup 作用域 = session = ExposeView/useExpose 的组件实例**；小程序页面实例销毁即组件卸载、session 随之销毁，重进页面产生新 session 自然可再报——这即「页面级去重」的实现形态。微信小程序 onHide→onShow（页面驻留）不算「重新进入」，不重报。

#### 5.3.3 useExpose.ts 契约（薄壳，不单测——仓库 hooks 惯例）

```ts
// src/hooks/useExpose.ts
// 曝光 hook:Taro.createIntersectionObserver 观测 + core/track/expose-logic 决策。
// 决策/去重全部在 expose-logic(纯函数,已单测);本文件只做宿主接线。
import Taro from "@tarojs/taro";
import { useEffect } from "react";

import { captureMessage } from "../core/monitor";
import { expose, type EventProps } from "../core/track";
import { createExposeSession } from "../core/track/expose-logic";

export interface UseExposeOptions {
  /** 观测目标选择器(ExposeView 生成的唯一 id,形如 "#expose-view-3") */
  selector: string;
  trackId: string;
  props?: EventProps;
}

export function useExpose({ selector, trackId, props }: UseExposeOptions): void {
  useEffect(() => {
    let observer: ReturnType<typeof Taro.createIntersectionObserver> | undefined;
    try {
      observer = Taro.createIntersectionObserver();
    } catch {
      // 降级(风险表):观测器创建失败 → 直接上报一次 + 记 monitor
      captureMessage("js_error", "曝光观测器创建失败,已降级直接上报", { trackId });
      expose(trackId, props);
      return;
    }
    const session = createExposeSession({
      trackId,
      report: (id) => expose(id, props)
    });
    try {
      observer.relativeToViewport().observe(selector, (res) => {
        const ratio = typeof res?.intersectionRatio === "number" ? res.intersectionRatio : 0;
        session.onVisible(ratio);
      });
    } catch {
      captureMessage("js_error", "曝光观测器挂载失败,已降级直接上报", { trackId });
      expose(trackId, props);
      session.dispose();
      return;
    }
    return () => {
      session.dispose();
      try {
        observer?.disconnect();
      } catch {
        // disconnect 失败静默
      }
    };
    // props 取首帧值:变更不重建观测(曝光语义以挂载时刻上下文为准)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector, trackId]);
}
```

#### 5.3.4 ExposeView.tsx 契约

```tsx
// src/component/ExposeView.tsx
import { View } from "@tarojs/components";
import { useMemo, type ReactNode } from "react";

import type { EventProps } from "../core/track";
import { useExpose } from "../hooks/useExpose";

// 实例级唯一 id 序号(模块级递增;无需可读性,只要同会话唯一)
let exposeViewSeq = 0;

export interface ExposeViewProps {
  trackId: string;
  props?: EventProps;
  className?: string;
  children?: ReactNode;
}

export function ExposeView({ trackId, props, className, children }: ExposeViewProps) {
  const id = useMemo(() => `expose-view-${++exposeViewSeq}`, []);
  useExpose({ selector: `#${id}`, trackId, props });
  return (
    <View id={id} className={["expose-view", className].filter(Boolean).join(" ")}>
      {children}
    </View>
  );
}
```

#### 测试用例表（tests/expose-logic.test.ts，纯 node，定时器全部注入 fake）

fake 定时器 harness（文件内定义）：`createFakeTimers()` 返回 `{ setTimeoutFn, clearTimeoutFn, fire(), cleared: unknown[], registeredMs: number[] }`——setTimeoutFn 记录 handler 与 ms 不自动触发，`fire()` 手动触发最近一个 handler。

| #    | 用例                                                                               | 断言                                                                                                                                                                                | 边界类                    |
| ---- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| EX1  | shouldExpose 阈值边界                                                              | (0.499,300)→F；(0.5,300)→T；(1,300)→T；(0.5,299)→F；(0.5,301)→T；(0.5,300) 双达标 T                                                                                                 | 越界                      |
| EX2  | shouldExpose 非法入参（空值/越界）                                                 | NaN、-1、Infinity、-0.1 各组合 → 全 F                                                                                                                                               | 空值/越界                 |
| EX3  | dedup 同实例去重                                                                   | tryMark 首 T 次 F；has 同步；size 变化；reset 后再 T（跨页面重置语义）                                                                                                              | 非法状态迁移              |
| EX4  | session 达标上报                                                                   | onVisible(0.5) → 注册 300ms 定时器；fire() → report 一次，入参 trackId                                                                                                              | —                         |
| EX5  | session 不足时不报                                                                 | onVisible(0.49) → 无定时器注册                                                                                                                                                      | 越界                      |
| EX6  | 持续判定：跌回撤表                                                                 | onVisible(0.6) → onVisible(0.2) → fire() 无 report；clearTimeout 被调                                                                                                               | 非法状态迁移              |
| EX7  | pending 不重复起表                                                                 | onVisible(0.6)×2 → 只注册一个定时器                                                                                                                                                 | 非法状态迁移              |
| EX8  | 同实例只报一次                                                                     | fire 后再 onVisible(0.9) + fire → report 仍只 1 次                                                                                                                                  | 非法状态迁移              |
| EX9  | 跨 session 各自可报                                                                | 两个 session 同 trackId 各走一遍 → report 共 2 次                                                                                                                                   | —                         |
| EX10 | dispose 幂等与静默                                                                 | pending 中 dispose → fire 无 report；dispose 后 onVisible 不再注册；dispose×2 不抛                                                                                                  | 非法状态迁移              |
| EX11 | 非法比例按 0（空值）                                                               | onVisible(NaN)/onVisible(-1) → 无定时器                                                                                                                                             | 空值                      |
| EX12 | track facade expose 事件（在 track_facade.test.ts 追加或本文件自测 createTracker） | `createTracker({queue: fake}).expose("home.banner", {a:1})` → 入队 `track.expose`，props 含 name=expose/trackId/a；`expose("")`/`expose("  ")` 零入队（空值）；enabled=false 零入队 | 空值/权限缺失（开关等价） |

---

### 5.4 卡 5.4：更新检查 + 网络状态 + app.tsx 接线

#### 文件清单

| 动作 | 文件                                                                                    |
| ---- | --------------------------------------------------------------------------------------- |
| 新增 | `src/core/update/index.ts`                                                              |
| 新增 | `src/hooks/network-status-logic.ts`                                                     |
| 新增 | `src/hooks/useNetworkStatus.ts`                                                         |
| 新增 | `tests/update.test.ts`                                                                  |
| 新增 | `tests/network-status.test.ts`                                                          |
| 修改 | `src/app.tsx`（checkUpdate / onNetworkStatusChange / onAppShow 刷新 / onAppHide flush） |

#### 5.4.1 core/update/index.ts 契约（core 零依赖：不 import Taro，宿主经 globalThis + 注入；不 import monitor——模块独立，失败回调由 app.tsx 接线）

```ts
// src/core/update/index.ts
// 小程序更新检查(决策 8):wx.getUpdateManager 三分支(ready/failed/no-update);
// dev 环境跳过(微信开发者工具无更新流程);宿主全部可注入,单测用 fake 驱动。
import { appEnv, type AppEnv } from "../../config";

/** wx.getUpdateManager() 返回体子集。 */
export interface UpdateManagerLike {
  onCheckForUpdate?: (callback: (res: { hasUpdate?: boolean }) => void) => void;
  onUpdateReady?: (callback: () => void) => void;
  onUpdateFailed?: (callback: () => void) => void;
  applyUpdate?: () => void;
}

/** wx.showModal 入参子集。 */
export interface ShowModalOptions {
  title: string;
  content: string;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  success?: (res: { confirm?: boolean }) => void;
}

/** 更新检查宿主(缺省读全局 wx)。 */
export interface UpdateHost {
  getUpdateManager?: () => UpdateManagerLike | undefined;
  showModal?: (options: ShowModalOptions) => void;
  canIUse?: (schema: string) => boolean;
}

export type UpdateCheckResult = "skipped_dev" | "unavailable" | "registered";

export interface CheckUpdateOptions {
  /** 注入宿主(单测);缺省全局 wx */
  host?: UpdateHost;
  /** 注入环境(单测);缺省读 config 的 appEnv */
  env?: AppEnv;
  /** 新版本下载失败回调(app.tsx 接 monitor.captureMessage) */
  onUpdateFailed?: () => void;
}

/** 更新就绪弹窗文案(锁定)。 */
export const UPDATE_MODAL_TITLE = "更新提示";
export const UPDATE_MODAL_CONTENT = "新版本已准备好,是否重启应用?";
export const UPDATE_MODAL_CONFIRM_TEXT = "重启";
export const UPDATE_MODAL_CANCEL_TEXT = "取消";

function defaultHost(): UpdateHost | undefined {
  return (globalThis as { wx?: UpdateHost }).wx;
}

/**
 * 注册更新检查:dev 跳过;宿主无能力静默降级;
 * ready → 弹窗(确认 → applyUpdate);failed → onUpdateFailed 回调。
 * 永不抛错。
 */
export function checkUpdate(options: CheckUpdateOptions = {}): UpdateCheckResult {
  const env = options.env ?? appEnv;
  if (env === "dev") return "skipped_dev";

  const host = options.host ?? defaultHost();
  if (host === undefined || typeof host.getUpdateManager !== "function") return "unavailable";
  if (typeof host.canIUse === "function" && !host.canIUse("getUpdateManager")) return "unavailable";

  let manager: UpdateManagerLike | undefined;
  try {
    manager = host.getUpdateManager();
  } catch {
    return "unavailable";
  }
  if (manager === undefined || manager === null) return "unavailable";

  manager.onUpdateReady?.(() => {
    const showModal = host.showModal;
    if (typeof showModal !== "function") {
      // 无弹窗能力:直接应用更新(新版本已下载完,停留旧版风险更大)
      manager.applyUpdate?.();
      return;
    }
    showModal({
      title: UPDATE_MODAL_TITLE,
      content: UPDATE_MODAL_CONTENT,
      confirmText: UPDATE_MODAL_CONFIRM_TEXT,
      cancelText: UPDATE_MODAL_CANCEL_TEXT,
      showCancel: true,
      success: (res) => {
        if (res?.confirm === true) manager.applyUpdate?.();
      }
    });
  });
  manager.onUpdateFailed?.(() => {
    options.onUpdateFailed?.();
  });
  return "registered";
}
```

设计决策（锁定）：不注册 `onCheckForUpdate`（无消费方，避免空回调噪音）；`onUpdateFailed` 的监控上报由 app.tsx 经回调接 monitor，保持 core/update 与 core/monitor 模块独立；无 showModal 能力的宿主直接 applyUpdate（已下载完成，直接重启优于滞留旧版）。

#### 5.4.2 network-status-logic.ts / useNetworkStatus.ts 契约

```ts
// src/hooks/network-status-logic.ts

/** 断网提示文案(锁定)。 */
export const OFFLINE_TIP_MESSAGE = "当前网络不可用,请检查网络设置";

/** 仅 "none" 视为断网;空值/未知/未取得一律按有网(保守不打扰)。 */
export function isOfflineNetworkType(networkType: string | null | undefined): boolean {
  return networkType === "none";
}
```

```ts
// src/hooks/useNetworkStatus.ts(薄壳,不单测)
import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";

import { isOfflineNetworkType } from "./network-status-logic";

export interface NetworkStatus {
  /** 微信网络类型(wifi/4g/none/...);未取得前为 "unknown" */
  networkType: string;
  isOffline: boolean;
}

/** 网络状态订阅:进入页面拉一次 + 监听变化;失败保持 "unknown"。 */
export function useNetworkStatus(): NetworkStatus {
  const [networkType, setNetworkType] = useState("unknown");
  useEffect(() => {
    const apply = (value: unknown) => {
      if (typeof value === "string" && value !== "") setNetworkType(value);
    };
    try {
      Taro.getNetworkType({ success: (res) => apply(res?.networkType) });
    } catch {
      // 读取失败保持 unknown
    }
    const handler = (res: { isConnected?: boolean; networkType?: string }) => {
      apply(res?.networkType);
    };
    Taro.onNetworkStatusChange(handler);
    return () => {
      Taro.offNetworkStatusChange(handler);
    };
  }, []);
  return { networkType, isOffline: isOfflineNetworkType(networkType) };
}
```

#### 5.4.3 app.tsx 最终形态（5.1 + 5.4 叠加；逐字接线）

```tsx
import { PropsWithChildren, useEffect } from "react";
import Taro, { useError, useLaunch, usePageNotFound, useUnhandledRejection } from "@tarojs/taro";

import { ErrorBoundary } from "./component/ErrorBoundary";
import {
  captureError,
  captureMessage,
  flushMonitor,
  normalizeJsError,
  normalizePageNotFound,
  normalizeUnhandledRejection
} from "./core/monitor";
import { mark } from "./core/perf";
import { flushTrack } from "./core/track";
import { refreshNetworkType } from "./core/track/params";
import { checkUpdate } from "./core/update";

import "./app.css";

function App({ children }: PropsWithChildren) {
  // 启动打点(N2.3)+ 更新检查(N5.4):dev 环境 checkUpdate 内部自动跳过
  useLaunch(() => {
    mark("app.launch");
    checkUpdate({
      onUpdateFailed: () => captureMessage("js_error", "小程序新版本下载失败")
    });
  });

  // 全局错误收口一行接线(N3,保持原样)
  useError((errorMessage) => captureError(normalizeJsError(errorMessage)));
  useUnhandledRejection((res) => captureError(normalizeUnhandledRejection(res)));
  usePageNotFound((res) => captureError(normalizePageNotFound(res)));

  // 生命周期与网络接线(N5.4):
  // - 网络变化 → 刷新 core/track 公共参数缓存(埋点 network 字段保鲜);
  // - app 回前台 → 刷新网络缓存;
  // - app 退后台 → 显式 flush track/monitor(transport 队列自身也有 hide flush,此为语义补接线)。
  useEffect(() => {
    const networkHandler = (res: { networkType?: string }) => {
      if (typeof res?.networkType === "string" && res.networkType !== "") {
        refreshNetworkType(undefined, res.networkType);
      }
    };
    const onShow = () => refreshNetworkType();
    const onHide = () => {
      void flushTrack();
      void flushMonitor();
    };
    Taro.onNetworkStatusChange(networkHandler);
    Taro.onAppShow(onShow);
    Taro.onAppHide(onHide);
    return () => {
      Taro.offNetworkStatusChange(networkHandler);
      Taro.offAppShow(onShow);
      Taro.offAppHide(onHide);
    };
  }, []);

  // 渲染异常根兜底(N5.1)
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

export default App;
```

（Taro 4 无 useAppShow/useAppHide hook——已在 node_modules 类型中核实——故 app 级 onShow/onHide 用 `Taro.onAppShow/onAppHide` 事件 API，与 core/transport 的 hide 监听先例一致。）

#### 测试用例表

**tests/update.test.ts**（host fake：回调落袋手动触发）：

| #    | 用例                                            | 断言                                                                                                                    | 边界类                       |
| ---- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| UP1  | dev 跳过                                        | env "dev" → "skipped_dev"；getUpdateManager 未被调                                                                      | 权限缺失（等价：环境不授权） |
| UP2  | 宿主缺失                                        | host 无 getUpdateManager / host undefined → "unavailable" 不抛                                                          | 空值                         |
| UP3  | canIUse 否定                                    | canIUse 返回 false → "unavailable"                                                                                      | 权限缺失                     |
| UP4  | getUpdateManager 抛错/返回 null（网络失败等价） | → "unavailable" 不抛                                                                                                    | 空值                         |
| UP5  | ready → 确认                                    | 触发 onUpdateReady 回调 → showModal 收到锁定文案四件 + showCancel true；success({confirm:true}) → applyUpdate 被调 1 次 | —                            |
| UP6  | ready → 取消                                    | success({confirm:false}) → applyUpdate 未调                                                                             | 非法状态迁移                 |
| UP7  | ready 但无 showModal 能力                       | → 直接 applyUpdate                                                                                                      | 空值                         |
| UP8  | failed 分支                                     | 触发 onUpdateFailed 回调 → options.onUpdateFailed spy 被调 1 次                                                         | 网络失败                     |
| UP9  | test/prod 不跳过                                | env "test"/"prod" → "registered"                                                                                        | —                            |
| UP10 | manager 缺回调方法（空值）                      | manager 无 onUpdateReady/onUpdateFailed → 仍 "registered" 不抛                                                          | 空值                         |

**tests/network-status.test.ts**：

| #   | 用例               | 断言                                                    | 边界类 |
| --- | ------------------ | ------------------------------------------------------- | ------ |
| NT1 | 断网判定           | "none" → true                                           | —      |
| NT2 | 有网与未知（空值） | "wifi"/"4g"/"5g"/"unknown"/""/null/undefined → 全 false | 空值   |
| NT3 | 文案常量           | OFFLINE_TIP_MESSAGE === "当前网络不可用,请检查网络设置" | —      |

app.tsx 不接单测（接线层；现有仓库亦无 app.tsx 测试——保持惯例）。

---

### 5.5 卡 5.5：client.ts 网络层增强

#### 文件清单

| 动作 | 文件                       |
| ---- | -------------------------- |
| 修改 | `src/api/client.ts`        |
| 新增 | `tests/api_client.test.ts` |

#### 契约（修改点逐条锁定）

1. **token 注入挂点（只写注释，不实现）**——在 `normalizeHeaders` 函数上方插入：

```ts
// 鉴权挂点(预留,决策 1 / 根规则 23):C 端用户体系落地后,在此向 header 注入
// Authorization: Bearer <token>(token 来源为未来的 TokenStore),并在 fail 分支接 401 语义。
// 当前为匿名公开受众:禁止实现任何鉴权逻辑,本注释仅为挂点标记。
```

2. **超时规范化**（抽出可测纯函数，替换现有内联三元）：

```ts
/** 单请求超时覆盖:非法值(非有限数 / <=0)回退默认 10s;合法值原样(ms,不设上限,平台侧 60s 上限兜底)。 */
export function resolveTimeoutMs(timeout: unknown): number {
  return typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0
    ? timeout
    : DEFAULT_TIMEOUT_MS;
}
```

`requestOnce` 中 `timeout: resolveTimeoutMs(config.timeout)`。

3. **请求取消（RequestTask abort + signal 挂点）**：

```ts
/** 请求取消错误:调用方主动 abort 的载体;不参与重试、不上报 monitor。 */
export class RequestAbortedError extends Error {
  constructor() {
    super("请求已取消");
    this.name = "RequestAbortedError";
  }
}

export function isRequestAbortedError(value: unknown): value is RequestAbortedError {
  return value instanceof RequestAbortedError;
}
```

`requestOnce` 改为：

```ts
/** axios 风格 signal 子集(AbortSignal 结构化鸭子类型;小程序运行时可能无 AbortController,守卫访问)。 */
interface SignalLike {
  aborted?: boolean;
  addEventListener?: (type: string, listener: () => void, options?: { once?: boolean }) => void;
}

function requestOnce<T>(config: AxiosRequestConfig, method: WeappMethod, url: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const signal = (config as { signal?: SignalLike }).signal;
    if (signal?.aborted === true) {
      reject(new RequestAbortedError());
      return;
    }
    let settled = false;
    const task = Taro.request({
      url,
      method,
      data: config.data,
      header: normalizeHeaders(config.headers),
      timeout: resolveTimeoutMs(config.timeout),
      success: (response) => {
        if (settled) return;
        settled = true;
        const isOk = response.statusCode >= 200 && response.statusCode < 300;
        if (!isOk) {
          reject(
            new RequestFailure(
              readErrorMessage(response.data, response.statusCode),
              response.statusCode
            )
          );
          return;
        }
        resolve(unwrapEnvelope<T>(response.data));
      },
      fail: (error) => {
        if (settled) return;
        settled = true;
        reject(new RequestFailure(error.errMsg || "网络请求失败"));
      }
    });
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener(
        "abort",
        () => {
          if (settled) return;
          settled = true;
          (task as { abort?: () => void })?.abort?.();
          reject(new RequestAbortedError());
        },
        { once: true }
      );
    }
  });
}
```

语义锁定：

- `settled` 双通道护栏：abort 触发的 fail 回调（`request:fail abort`）不得二次 settle。
- 已 settle 后 abort 到达 → 静默忽略。
- 取消**不重试、不上报 monitor**：`customInstance` 捕获段首行加：

```ts
    } catch (error) {
      if (error instanceof RequestAbortedError) {
        throw error; // 调用方主动取消:不重试、不上报、原样抛出
      }
      lastError = error;
      // ...(原有重试判定不变)
```

（即取消立即跳出循环原样抛出；实现上放在 catch 首行。）

- signal 挂点是能力预留：orval 生成物当前不会传 signal，直接调 `customInstance` 的调用方可以传；未来生成物包装层按 axios 约定透传即可。不新增任何 helper。

4. **dev 请求日志**：

```ts
// import 区追加:import { API_BASE_URL, appEnv } from "../config";(原只有 API_BASE_URL)

/** dev 环境输出请求日志(控制台);其余环境静默。导出供单测。 */
export function shouldLogRequests(env: string): boolean {
  return env === "dev";
}
```

`customInstance` 内（成功与最终失败两条出口各一处，或统一 finally 前记录——锁定实现点：在 `return await requestOnce(...)` 成功路径与抛出前统一记录）：

```ts
const startedAt = Date.now();
// ...成功路径 return 前:
if (shouldLogRequests(appEnv)) {
  console.debug("[api]", method, url, { ok: true, durationMs: Date.now() - startedAt });
}
// ...最终失败抛出前(captureError 调用后):
if (shouldLogRequests(appEnv)) {
  console.debug("[api]", method, url, {
    ok: false,
    statusCode,
    durationMs: Date.now() - startedAt
  });
}
```

锁定：前缀 `[api]`；只在 `appEnv === "dev"` 输出；取消路径**不打**（非失败亦非成功，属调用方主动行为）。

#### 测试用例表（tests/api_client.test.ts）

**测试方式（锁定）**：`vi.mock("@tarojs/taro", ...)` 提供可编程 `Taro.request`；`vi.mock("../src/core/monitor", ...)` spy `captureError`；dev 日志用例用 `vi.mock("../src/config", async (importOriginal) => ({ ...(await importOriginal() as object), appEnv: "dev" }))` 单独文件分区或 vi.doMock + 动态 import。**禁止**新增 jsdom/testing-library。

harness（文件内定义）：

```ts
// 每个用例重挂 requestBehavior:
// - 成功队列: [{statusCode, data}]
// - 失败: {fail: {errMsg}} 或 pending(不回调)
// - 记录: 每次调用的 options;返回 task = { abort: vi.fn(() => 触发 fail {errMsg:"request:fail abort"}) }(按用例开关)
```

| #    | 用例                               | 断言                                                                                                                                                        | 边界类       |
| ---- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| CL1  | 成功信封解包（回归）               | 200 + `{code:0,message:"ok",data:{message:"pong"}}` → resolve `{message:"pong"}`                                                                            | —            |
| CL2  | GET 瞬时失败重试（网络失败，回归） | fail→success → resolve；request 调 2 次                                                                                                                     | 网络失败     |
| CL3  | POST 不重试（回归）                | fail → reject；request 调 1 次；captureError 1 次（api_error）                                                                                              | 网络失败     |
| CL4  | 4xx 不重试（回归）                 | success 回调 statusCode 403 → reject；request 1 次                                                                                                          | 权限缺失     |
| CL5  | 5xx GET 重试后仍失败               | fail×2 → reject；request 2 次；captureError 1 次                                                                                                            | 网络失败     |
| CL6  | 超时覆盖生效                       | config.timeout=5000 → Taro.request 收到 timeout 5000                                                                                                        | —            |
| CL7  | 超时非法回退（零值/越界）          | timeout 0 / -1 / NaN / undefined → 全 10000                                                                                                                 | 零值/越界    |
| CL8  | 预取消（空值）                     | signal 已 aborted → reject RequestAbortedError；request **未被调用**                                                                                        | 空值         |
| CL9  | 飞行中取消                         | abort() → task.abort 被调、reject RequestAbortedError；abort 触发的 fail 回调不二次 settle（promise 只 settle 一次，reject 形态为取消而非「网络请求失败」） | 非法状态迁移 |
| CL10 | 取消不重试不上报                   | GET + abort → request 1 次；captureError 未调                                                                                                               | 网络失败     |
| CL11 | settle 后 abort 静默               | 先 success 再 abort → 无二次 settle，task.abort 不再被调                                                                                                    | 非法状态迁移 |
| CL12 | dev 请求日志                       | 挂 dev config mock + console.debug spy：成功与失败各产生一条 `[api]` 前缀日志                                                                               | —            |
| CL13 | 非 dev 静默（权限缺失等价）        | 默认（test 环境）→ console.debug 零调用                                                                                                                     | 权限缺失     |
| CL14 | 信封非 2xx 文案（回归）            | 500 + `{message:"boom"}` → reject message "boom"；无 message → `请求失败(500)`                                                                              | 网络失败     |

---

## 6. 依赖与配置变更汇总

### mobile（pubspec.yaml）

| 依赖                | 版本     | 用途                                | 状态                                                                                                                                                      |
| ------------------- | -------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectivity_plus` | `^6.1.4` | NetworkStatusService 桥接（卡 4.3） | **钉版本待评审**（6.x 为已知稳定大版本；无 Flutter SDK 无法解析 lock，首个有环境者 `flutter pub get` 后回填精确版本；若 6.1.4 不存在取 6.1.x 最新并记录） |

其余依赖零变更。阶段 7 的 `visibility_detector` 不在本阶段引入。

### miniapp（package.json）

**零变更**。已核查：`@testing-library/react`、`jsdom`、`react-test-renderer` 均不存在且**不引入**——组件测试走「直接调用函数组件 / new 类实例 + element 树结构断言 + `vi.mock("@tarojs/components")`」形态（§5.1/§5.2 已锁定）；该形态与仓库「单测不渲染 Taro 组件」的 vitest.config 注释一致，只是把断言层推进到 element 结构而非 DOM。

---

## 7. 六类边界覆盖映射总表

| 边界类       | mobile（阶段 4）                       | miniapp（阶段 5）                                                                   |
| ------------ | -------------------------------------- | ----------------------------------------------------------------------------------- |
| 空值         | PS3/PS4/PS6、RL4、LC1/LC4/LC5、NS1     | EB2/EB3/EB4、PST1/PST2/PST7、EX11/EX12、UP2/UP4/UP7/UP10、NT2、CL8                  |
| 零值         | NS2、PS1（组合）                       | PST3、EB8、CL7                                                                      |
| 越界         | NS1（空列表）、PS1                     | EX1/EX2/EX5、EB3、CL7                                                               |
| 权限缺失     | RL2（prod 静默等价）                   | UP1/UP3（dev 跳过 / canIUse 否定）、EX12（总开关）、CL13（非 dev 静默）、CL4（4xx） |
| 网络失败     | RL3/RL6、NS5、LC6                      | CL2/CL3/CL5/CL10/CL14、UP4/UP8                                                      |
| 非法状态迁移 | PS1/PS8、RL5/RL7、LC3/LC7、NS3/NS6/NS7 | PST4、EB10、EX3/EX6/EX7/EX8/EX10、UP6、CL9/CL11                                     |

注：匿名公开受众无登录权限体系，「权限缺失」在两侧均以等价形态覆盖（输出门控 / 能力缺失 / 4xx 不重试），与既有测试纪律（miniapp AGENTS §5）一致。

---

## 8. 易错点清单（实现时逐项自查）

1. **miniapp import 大小写**：组件文件名 PascalCase（`ErrorBoundary.tsx`），import 必须逐字 `./component/ErrorBoundary`——macOS 大小写不敏感能跑、Linux CI 会炸。
2. **core 零依赖红线**：`expose-logic.ts`、`update/index.ts` 只允许相对路径 import（`../../config` 允许，`../monitor` **不允许**——模块独立）；eslint `no-restricted-imports` 会拦裸包名。update 的失败上报经 `onUpdateFailed` 回调由 app.tsx 接 monitor，就是为了不破坏模块独立。
3. **TrackEventType 加 expose 后**：`enqueue("expose", "expose", ...)` 的 name 固定 `"expose"`，事件名为 `track.expose`；不要发明 `track.exposure` 等别名。
4. **mobile core 依赖登记**：`network → logging`、`lifecycle → analytics/logging` 必须先落 AGENTS.md §2 登记（§4.3.4 给定原文）再写代码，顺序即合规证据。
5. **dioCall 取消判定顺序**：`e.type == cancel || cancelToken.isCancelled` 必须在 `error is AppError` 解包**之前**——信封拦截器会把取消包成网络失败 AppError，顺序错了取消会被误判成网络失败。
6. **RequestLogInterceptor 永不阻断**：三个回调都必须 `handler.next(...)` 到底；context 的 `durationMs` 只在起点标记存在时出现。
7. **NetworkStatusService 去重**：`_apply` 同值不广播；`stream` 不回放首值，消费方先读 `current`。
8. **AppLifecycleService 同态去重**：连续两个 paused 只报一次 `app.background`；中间态（inactive/hidden/detached）不产生事件。
9. **miniapp 测试禁新依赖**：无 jsdom/testing-library；组件测试 = 直接调用 + element 树断言 + `vi.mock("@tarojs/components")`；每文件 afterEach 还原全局 stub 与 `vi.restoreAllMocks()`。
10. **client.ts 取消语义**：`RequestAbortedError` 不进重试循环、不进 monitor、不进 dev 日志；`settled` 护栏防 abort→fail 双 settle。
11. **app.tsx 生命周期**：Taro 4 无 `useAppShow/useAppHide`，用 `Taro.onAppShow/onAppHide/offAppShow/offAppHide`（已核实类型存在）；useEffect cleanup 必须 off 掉三个监听。
12. **mobile widget 测试全标记待环境**：本机无 Flutter SDK，所有 `test/` 新文件按现有范式书写（fake 注入、不触插件真实调用），在有 Flutter SDK 的环境执行 `flutter test` 验收；connectivity_plus 插件薄壳（ConnectivityNetworkStatusSource）不写单测，只测 `mapConnectivityResults` 纯函数与 service（fake source）。
13. **注释与文案语言**：源码注释、面向用户文案一律中文；事件名英文蛇形（`app.foreground` / `app.background` / `track.expose`）。
14. **不改生成物**：`src/api/generated/**`、`src/api/controllers.gen.ts` 不在本阶段触碰。
15. **prettier/gofmt 风格**：miniapp 走仓库 prettier（双引号、分号、trailingComma none、printWidth 100）；mobile 走 `dart format`（待环境）+ `flutter_lints`。

---

## 9. 验收命令与标准

### 阶段 5（miniapp，可本地全量执行）

```bash
pnpm --filter @monorepo-template/miniapp lint
pnpm --filter @monorepo-template/miniapp typecheck
pnpm --filter @monorepo-template/miniapp test
pnpm --filter @monorepo-template/miniapp exec vitest run --coverage   # core ≥90 / 整体 ≥70 不破
```

逐条验收：

1. 四命令退出码 0。
2. §5 测试用例表编号（EB/PST/EX/UP/NT/CL）齐全且全绿；既有 7 个测试文件不回归。
3. 覆盖率门槛不破（新增 `src/core/track/expose-logic.ts`、`src/core/update/index.ts` 属 core，按 90% 线自查）。
4. `src/core/**` 无任何第三方 import（lint 已固化）。
5. package.json dependencies/devDependencies 零变更。
6. app.tsx 接线与 §5.4.3 逐字一致（ErrorBoundary 包裹、checkUpdate、三个监听与 cleanup）。

### 阶段 4（mobile，待 Flutter 环境执行）

本机无 Flutter SDK，以下为**待环境**验收项（在有 Flutter SDK 的机器上执行）：

```bash
cd apps/mobile
flutter pub get          # 解析 connectivity_plus,回填精确版本到执行记录
dart format --set-exit-if-fail lib test
flutter analyze
flutter test             # PS/RL/NS/LC 用例 + 既有 58 例全绿
```

本地可执行的静态自查（编码 agent 交付前必须做）：

1. 文件清单与 §4 完全一致；新增 Dart 文件 import 形态锁定：一律照 `lib/core/network/ping_repository.dart`——第三方包与跨目录引用用 `package:cms_mobile/...` 绝对 import（如 `package:cms_mobile/core/logging/app_logger.dart`），§4 代码块即此形态，不得改为相对路径。
2. `pubspec.yaml` 仅新增一行 `connectivity_plus: ^6.1.4`（字母序位于 `dio` 前），无其它 diff。
3. `apps/mobile/AGENTS.md` 仅 §2 例外清单一处有界追加。
4. `git status` 改动范围不越出 §2 所有权表。

### 阶段门禁（planner）

- 阶段 5 全绿 + 阶段 4 静态自查通过 → 阶段 4/5 验收完成；Flutter 相关项在执行记录标注「待 Flutter 环境执行」。
- `pnpm verify` 全量不需要为本阶段跑（与 mobile 无关的 desktop e2e 等）；miniapp 四命令 + mobile 静态自查即门禁。
