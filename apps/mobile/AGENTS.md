# apps/mobile/AGENTS.md

本文件面向 AI 编码助手,是 `apps/mobile`(Flutter 手机端,匿名公开受众,消费 [`openapi/app/`](../../openapi/app/))的架构约束规范。
根 [AGENTS.md](../../AGENTS.md) 规则 25 在此展开;壳建设方案与现状依据见 [docs/flutter-shell-plan.md](../../docs/flutter-shell-plan.md),人读运行手册见 [README.md](README.md)。
本文件与根规则冲突时以本文件为准。

## 1. 分层图

```
lib/
  main.dart               # 装配入口:AppConfig → 全局错误收口 → Sentry 条件初始化 → ProviderScope(overrides) → runApp
  app.dart                # MaterialApp.router:theme / l10n / router 挂载,不感知具体实现
  app_providers.dart      # 装配层:core 服务的 Provider 与实现选择(override 即"配置坑"的落地形式)
  core/
    config/               # AppConfig + Flavor:dart-define 唯一读取口(人人可依赖)
    logging/              # AppLogger 抽象 + ConsoleLogger(ERROR 级挂接 ErrorReporter)
    error/                # ErrorReporter 抽象 + Noop/Sentry 实现 + AppError 模型
    monitoring/           # PerformanceMonitor/TraceHandle 抽象 + Noop/Sentry 实现
    analytics/            # EventTracker 抽象 + Console/Sentry 实现
    network/              # dio 工厂 + 信封/重试拦截器 + 各资源 Repository(PingRepository)
    storage/              # KeyValueStore 抽象 + SharedPreferences 实现
  router/                 # go_router 路由表 + 路由错误页
  theme/                  # ThemeData 亮/暗(design tokens 占位)
  l10n/                   # supportedLocales(intl 生成链留坑,首条业务文案时启用)
  features/<域>/          # 业务页面:providers + page + test 三件(home 为范式样板)
```

## 2. 依赖方向硬规则

- 允许方向:`features → core`(服务实例一律经 `app_providers.dart` 的 Provider 获取,不自行构造实现);`router`/`app.dart` 可 import features(装配与挂载);
- **core 模块之间互不依赖**,仅两类已登记例外:`config`(人人可用)与 `error`(`network` 以 `AppError` 为唯一错误模型、`logging` 的 ERROR 级挂接 `ErrorReporter` 是接口契约);另登记(阶段 4):`network → logging`(请求日志拦截器复用 AppLogger)、`lifecycle → analytics`(前后台事件埋点)与 `lifecycle → logging`(flush 钩子失败告警,可选依赖);另登记(阶段 6):`hybrid → permission`(JSB 媒体方法权限前置,仅引用 AppPermission/PermissionAppState 类型);另登记(阶段 7):`update → network`(更新检查复用网络层 VersionRepository,与 features 经 Repository 消费数据同范式);新增跨模块依赖先在本条登记再写代码;
- **`core/` 与 `app_providers.dart` 禁止 import `features/`**;features 之间禁止互相 import(页面跳转走路由表);
- 业务代码只面向 core 抽象接口,禁止直接 import `dio`/`sentry_flutter`/`shared_preferences` 等第三方实现包(网络经 `core/network`,上报经 `ErrorReporter`,存储经 `KeyValueStore`)。

## 3. 禁止事项

- **禁 `print`/`debugPrint`**(test 除外):日志统一经注入的 `AppLogger` 输出,禁止散落字面量日志;
- **禁裸 `new Dio()`**:`core/network/dio_client.dart` 的 `buildDio` 是唯一构造入口(信封/重试拦截器的装配顺序即管道契约);调用统一走 `dioCall` 边界,业务只 catch `AppError` 一种类型;
- **禁裸读 `Platform.environment` / `String.fromEnvironment`**:构建期配置唯一读取口是 `core/config/app_config.dart`;
- **禁绕过 `KeyValueStore` 直用 `SharedPreferences`**:业务不 import `shared_preferences`,本地键值读写一律走注入的 `KeyValueStore`。

## 4. 配置坑清单(--dart-define)

与 `core/config/app_config.dart` 字段一一对应;键与缺省值即对外契约,变更需同步本表与 README:

| key                         | 用途                           | 缺失行为                                                                          |
| --------------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| `API_BASE_URL`              | 后端基地址                     | 默认 `http://localhost:18085`(Android 模拟器访问宿主机用 `http://10.0.2.2:18085`) |
| `SENTRY_DSN`                | Sentry 接入                    | 缺失(空串)→ `SentryFlutter.init` 跳过,ErrorReporter/PerformanceMonitor 全部 no-op |
| `SENTRY_TRACES_SAMPLE_RATE` | 性能采样率(0.0~1.0)            | 默认 0.0;解析失败或 ≤0 时 PerformanceMonitor no-op                                |
| `FLAVOR`                    | dev/staging/prod               | 缺失或非法值回退 dev                                                              |
| `ANALYTICS_ENABLED`         | 埋点总开关                     | 默认 false(Console 实现,debugPrint 核对);true 时埋点走 Sentry breadcrumb          |
| `APP_VERSION`               | JSB getAppVersion 展示用版本号 | 默认 0.1.0                                                                        |
| `BUILD_NUMBER`              | JSB getAppVersion 构建号       | 默认 1                                                                            |
| `PUSH_ENABLED`              | Push SDK 总开关                | 默认 false(NoopPushService,SDK 后接)                                              |

## 5. 接口替换点清单

监控/日志/存储五接口,业务只面向抽象;替换实现 = 改 `app_providers.dart` 对应 Provider 的选型逻辑(main.dart 的 overrides 按同一选型定值),业务零改动:

| 接口                 | 抽象位置                                   | 实现(与抽象同目录)                                                     | 装配点与选型                                                            |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `ErrorReporter`      | `core/error/error_reporter.dart`           | `NoopErrorReporter` / `SentryErrorReporter`                            | `errorReporterProvider`;DSN 空 → Noop                                   |
| `PerformanceMonitor` | `core/monitoring/performance_monitor.dart` | `NoopPerformanceMonitor` / `SentryPerformanceMonitor`                  | `performanceMonitorProvider`;DSN 空或采样率 ≤0 → Noop                   |
| `EventTracker`       | `core/analytics/event_tracker.dart`        | `ConsoleEventTracker` / `SentryEventTracker`(工厂 `buildEventTracker`) | `eventTrackerProvider`;`analyticsEnabled` 决定                          |
| `AppLogger`          | `core/logging/app_logger.dart`             | `ConsoleLogger`(ERROR 级自动转发 ErrorReporter)                        | `appLoggerProvider`;reporter 随装配注入                                 |
| `KeyValueStore`      | `core/storage/key_value_store.dart`        | `SharedPreferencesKeyValueStore`                                       | 暂无业务消费、未挂 Provider;接入时先在 `app_providers.dart` 增 Provider |

新实现放对应接口同目录;测试替身经 ProviderScope `overrides` 注入(`test/helpers/pump_app.dart` 的 `FakePingRepository` 即范式)。

## 6. 新增 feature 范式

以 `features/home/` 为样板,三件:

1. `features/<域>/<域>_providers.dart`:状态层,Riverpod `AsyncNotifier` 承载 loading/success/failure 三态;失败态保留 `AppError` 供页面渲染重试入口,并关闭 Riverpod 自动重试(`retry` 返回 null),重试语义由页面手动 `retry()` 承担;
2. `features/<域>/<域>_page.dart`:视图层,只做三态渲染(`switch` `AsyncValue`),不持业务逻辑;
3. `test/widget/<域>_page_test.dart`:widget 测试,经 `test/helpers/pump_app.dart` 的包装(ProviderScope + MaterialApp(theme) + overrides 注入替身数据源),不触真实网络;六类边界必查(根规则 17)。

数据源:新资源 Repository 放 `core/network/`(照 `ping_repository.dart`:走 `dioCall`、只抛 `AppError`),Provider 挂 `app_providers.dart`;契约先落 [`openapi/app/`](../../openapi/app/),dart 侧生成链落地前手写调用、不手写与契约重复的类型。

## 7. 与根规则的关系

根规则 25 在此展开:最小包约定不变——仓库只保留 `pubspec.yaml` + `lib/` + `test/`,平台目录不入库(首次执行 `flutter create . --platforms=android,ios` 补齐)、`pubspec.lock` 不入库;Android 模拟器内 `localhost` 指向模拟器自身,访问宿主机用 `10.0.2.2`;`pubspec.yaml` 是依赖单点,新增依赖先评审并一次钉定版本。本文件与根规则冲突时以本文件为准。
