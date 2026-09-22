# apps/mobile — CMS 手机端(Flutter)

CMS 的 Flutter 手机端(分层壳已落地:core 七模块 + Riverpod/go_router 壳),消费公开契约 [`openapi/app/openapi.yaml`](../../openapi/app/openapi.yaml) 的 `GET /api/app/ping`:启动时请求该端点,经 dio 信封拦截器解析 `{code, message, data}` 并把 `data.message`(`pong from app api`)渲染到首页;失败时降级展示错误信息并提供重试。

架构约束(AI 编码助手)见 [AGENTS.md](AGENTS.md);壳建设方案见 [docs/flutter-shell-plan.md](../../docs/flutter-shell-plan.md)。dart 侧 OpenAPI 生成链列入后续阶段,当前手写调用(`lib/core/network/`)对齐契约。

## 前置要求

- Flutter SDK(stable 渠道,建议最新版;`flutter_lints` 最新版要求 Dart ≥ 3.8)。

## 首次初始化:补齐平台脚手架

本仓库为保持精简,**未提交 android/ios 等平台目录**,仅手工维护 `pubspec.yaml` + `lib/` + `test/`。首次在装有 Flutter SDK 的环境执行一次:

```bash
cd apps/mobile
flutter create . --platforms=android,ios
```

该命令只补齐缺失的平台脚手架(android/ios 等),不会覆盖已有的 `lib/` 与 `test/`。

## 本地运行

1. 启动后端(Go server,默认 18085):仓库根 `pnpm dev`,或参见 `apps/server`;
2. 运行 App:

```bash
flutter pub get
flutter run
```

后端地址等环境配置全部走构建期 `--dart-define`(见下表),缺省请求 `http://localhost:18085/api/app/ping`。

**Android 模拟器**内 `localhost` 指向模拟器自身,访问宿主机需用 `10.0.2.2`——无需改任何代码,运行时注入即可:

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:18085
```

## 配置坑清单(--dart-define)

与 `lib/core/config/app_config.dart` 字段一一对应;键与缺省值即对外契约,变更需同步 [AGENTS.md](AGENTS.md) §4:

| key                         | 用途                           | 缺失行为                                                                  |
| --------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| `API_BASE_URL`              | 后端基地址                     | 默认 `http://localhost:18085`(模拟器访问宿主机用 `http://10.0.2.2:18085`) |
| `SENTRY_DSN`                | Sentry 接入                    | 缺失(空串)→ Sentry 不初始化,错误上报/性能监控全部 no-op                   |
| `SENTRY_TRACES_SAMPLE_RATE` | 性能采样率(0.0~1.0)            | 默认 0.0(不采样)                                                          |
| `FLAVOR`                    | dev/staging/prod               | 缺失或非法值回退 dev                                                      |
| `ANALYTICS_ENABLED`         | 埋点总开关                     | 默认 false(Console 输出);true 时埋点走 Sentry breadcrumb                  |
| `APP_VERSION`               | JSB getAppVersion 展示用版本号 | 默认 0.1.0                                                                |
| `BUILD_NUMBER`              | JSB getAppVersion 构建号       | 默认 1                                                                    |
| `PUSH_ENABLED`              | Push SDK 总开关                | 默认 false(NoopPushService,SDK 后接)                                      |

常用组合示例:

```bash
# 本地联调(Android 模拟器指向宿主机 server)
flutter run \
  --dart-define=API_BASE_URL=http://10.0.2.2:18085 \
  --dart-define=FLAVOR=dev

# 接入 Sentry(填 DSN 即启用)并开启性能采样
flutter run \
  --dart-define=SENTRY_DSN=https://<publicKey>@<orgId>.ingest.sentry.io/<projectId> \
  --dart-define=SENTRY_TRACES_SAMPLE_RATE=0.2 \
  --dart-define=FLAVOR=prod
```

## Sentry 接入说明

- **填 DSN 即启用,缺省 no-op**:`SENTRY_DSN` 非空时 `lib/main.dart` 才执行 `SentryFlutter.init`;缺失时错误上报/性能监控为 Noop 实现,行为与未接入完全一致(与 site 的 RUM"缺 env 不初始化"同哲学);
- 启用后统一收口三类未捕获异常并转发 `ErrorReporter`:`runZonedGuarded`(zone 内异常)、`FlutterError.onError`(框架/布局异常)、`PlatformDispatcher.onError`(平台线程异常);
- 性能监控需 `SENTRY_TRACES_SAMPLE_RATE > 0` 才生效(`PerformanceMonitor.startTrace` 返回事务句柄),为 0 时 no-op;
- 业务埋点(`ANALYTICS_ENABLED=true`)走 Sentry breadcrumb,不占事件配额;false 时为 Console 实现(debugPrint,便于开发期核对)。

## 测试与静态检查

```bash
flutter analyze
flutter test                # 单测 + widget 测试全量
flutter test --coverage     # 生成 coverage/lcov.info(coverage/ 已 gitignore,不入库)
```

CI(subosito/flutter-action,stable)同样执行 `flutter analyze && flutter test --coverage` 并上传 lcov 工件,不设硬覆盖率门槛(壳阶段样本太小,业务接入后再加)。本地 `scripts/verify.sh` 的 flutter 段与 CI 同构。目录约定:

```
test/unit/                       # 纯逻辑单测(信封/重试/dio 工厂/监控与存储实现)
test/widget/                     # 页面三态(loading/success/failure),不触真实网络
test/helpers/                    # 测试包装与替身(pumpHomePage + FakePingRepository)
test/integration_ping_test.dart  # 联通验证:对真实 server 的信封链路(server 未启动自动跳过)
```

## 目录说明

```
lib/main.dart            # 装配:AppConfig → 全局错误收口 → Sentry 条件初始化 → ProviderScope(overrides)
lib/app.dart             # MaterialApp.router(theme/l10n/router 挂载)
lib/app_providers.dart   # 装配层:core 服务 Provider 与实现选择
lib/core/                # 七模块:config / logging / error / monitoring / analytics / network / storage
lib/router/ theme/ l10n/ # go_router 路由表 + 错误页 / 亮暗主题 / 语区清单
lib/features/home/       # ping 页(provider + view,业务接入范式样板)
```
