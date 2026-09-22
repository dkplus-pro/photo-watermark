// 装配层 Provider(方案 docs/flutter-shell-plan.md §3/§4 阶段 3.1):
// core 服务的实例选择全部收敛在此,main.dart 经 buildProviderOverrides 注入;
// 业务/feature 只面向接口(override 即替换,是"配置坑"的落地形式)。
import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/analytics/event_tracker.dart';
import 'core/analytics/event_tracker_impls.dart';
import 'core/config/app_config.dart';
import 'core/error/error_reporter.dart';
import 'core/error/sentry_error_reporter.dart';
import 'core/lifecycle/app_lifecycle.dart';
import 'core/logging/app_logger.dart';
import 'core/logging/console_logger.dart';
import 'core/media/file_service.dart';
import 'core/media/image_compress_service.dart';
import 'core/media/image_info_service.dart';
import 'core/media/media_picker_service.dart';
import 'core/media/media_saver_service.dart';
import 'core/monitoring/performance_monitor.dart';
import 'core/monitoring/sentry_performance_monitor.dart';
import 'core/network/dio_client.dart';
import 'core/network/network_status.dart';
import 'core/network/ping_repository.dart';
import 'core/network/request_log_interceptor.dart';
import 'core/network/version_repository.dart';
import 'core/permission/permission_handler_service.dart';
import 'core/permission/permission_service.dart';
import 'core/push/push_service.dart';
import 'core/update/update_checker.dart';

/// 应用配置:main.dart 已按 dart-define 构建实际实例并 override,这里仅是类型兜底。
final appConfigProvider =
    Provider<AppConfig>((ref) => AppConfig.fromDartDefines());

/// 错误上报:DSN 缺失 → Noop(与 site RUM"缺 env 不初始化"同哲学)。
final errorReporterProvider = Provider<ErrorReporter>((ref) {
  final config = ref.watch(appConfigProvider);
  return config.sentryDsn.isEmpty
      ? const NoopErrorReporter()
      : const SentryErrorReporter();
});

/// 性能监控:DSN 或采样率未启用 → Noop。
final performanceMonitorProvider = Provider<PerformanceMonitor>((ref) {
  final config = ref.watch(appConfigProvider);
  return config.sentryDsn.isEmpty || config.sentryTracesSampleRate <= 0
      ? const NoopPerformanceMonitor()
      : const SentryPerformanceMonitor();
});

/// 埋点:analyticsEnabled 关 → Console 实现。
final eventTrackerProvider = Provider<EventTracker>(
  (ref) => buildEventTracker(ref.watch(appConfigProvider)),
);

/// 分级日志:ERROR 级自动挂接 ErrorReporter(见 ConsoleLogger)。
final appLoggerProvider = Provider<AppLogger>(
  (ref) => ConsoleLogger(errorReporter: ref.watch(errorReporterProvider)),
);

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

/// Ping 数据源:测试经 override 注入 Fake(test/helpers/pump_app.dart)。
final pingRepositoryProvider = Provider<PingRepository>(
  (ref) => PingRepository(ref.watch(dioProvider)),
);

/// 网络状态:全局单例服务;app.dart initState 启动(start + 首次 refresh)。
/// 测试经 override 注入 fake source 的 service。
final networkStatusServiceProvider = Provider<NetworkStatusService>((ref) {
  final service =
      NetworkStatusService(source: ConnectivityNetworkStatusSource());
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

/// 权限服务(卡 6.1):permission_handler 薄壳;测试经 override 注入 fake gateway 的 service。
final permissionServiceProvider = Provider<PermissionService>(
  (ref) => const PermissionHandlerPermissionService(),
);

/// 选图(卡 6.2)。
final mediaPickerServiceProvider = Provider<MediaPickerService>(
  (ref) => ImagePickerMediaPickerService(),
);

/// 图片压缩(卡 6.2)。
final imageCompressServiceProvider = Provider<ImageCompressService>(
  (ref) => FlutterImageCompressService(),
);

/// 相册保存(卡 6.2)。
final mediaSaverServiceProvider = Provider<MediaSaverService>(
  (ref) => const GalMediaSaverService(),
);

/// 图片信息读取(卡 6.2)。
final imageInfoServiceProvider = Provider<ImageInfoService>(
  (ref) => const UiImageInfoService(),
);

/// 文件选择(卡 6.2;本期无业务消费,Provider 先行供后续 uploadFile 阶段复用)。
final fileServiceProvider = Provider<FileService>(
  (ref) => FilePickerFileService(),
);

/// Push(卡 7.2):PUSH_ENABLED=false 或 SDK 未接入 → Noop;真实 SDK 实现后在此按 config.pushEnabled 选型。
final pushServiceProvider = Provider<PushService>((ref) {
  // 决策 7:本期只交付 Noop;config.pushEnabled 为 true 时同样落 Noop 并留 TODO(SDK 实装点)。
  return const NoopPushService();
});

/// 版本检查仓库(卡 7.4):测试经 override 注入 fake。
final versionRepositoryProvider = Provider<VersionRepository>(
  (ref) => VersionRepository(ref.watch(dioProvider)),
);

/// 更新检查编排(卡 7.4):失败降级 kNoUpdate 并经 AppLogger 告警。
final updateCheckerProvider = Provider<UpdateChecker>(
  (ref) => UpdateChecker(
    repository: ref.watch(versionRepositoryProvider),
    config: ref.watch(appConfigProvider),
    onError: (Object error) =>
        ref.read(appLoggerProvider).warn('update check failed: $error'),
  ),
);
