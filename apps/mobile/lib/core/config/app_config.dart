/// 运行环境档位;`--dart-define FLAVOR=...` 注入,缺省 dev。
enum Flavor { dev, staging, prod }

/// 应用配置:全部环境差异(--dart-define)的唯一读取口。
///
/// 依赖方向:任何层可用(config 是人人可依赖的例外);业务代码禁止裸读
/// `String.fromEnvironment` / `Platform.environment`,必须经本类取值。
/// 配置坑清单见 apps/mobile/README.md。
class AppConfig {
  const AppConfig({
    required this.flavor,
    required this.apiBaseUrl,
    required this.sentryDsn,
    required this.sentryTracesSampleRate,
    required this.analyticsEnabled,
    required this.appVersion,
    required this.buildNumber,
    required this.pushEnabled,
  });

  final Flavor flavor;

  /// 后端基地址;Android 模拟器访问宿主机需用 10.0.2.2(见 apps/mobile/README.md)。
  final String apiBaseUrl;

  /// Sentry DSN;空串 = ErrorReporter/PerformanceMonitor 全部 no-op
  /// (与 site 的 ARMS RUM"缺 env 不初始化"同哲学)。
  final String sentryDsn;

  /// 性能采样率 0.0~1.0,默认 0(壳阶段不采)。
  final double sentryTracesSampleRate;

  /// 埋点总开关,默认 false(console 实现也不输出)。
  final bool analyticsEnabled;

  /// 应用版本号(展示用);--dart-define APP_VERSION 注入,缺省与 pubspec version 对齐。
  final String appVersion;

  /// 构建号;--dart-define BUILD_NUMBER 注入,缺省 '1'。
  final String buildNumber;

  /// Push 总开关;false → NoopPushService(决策 7)。
  final bool pushEnabled;

  /// 从构建期 --dart-define 读取全部配置;键与缺省值即对外契约,变更需同步 README。
  factory AppConfig.fromDartDefines() => AppConfig(
        flavor: Flavor.values.firstWhere(
          (f) => f.name == const String.fromEnvironment('FLAVOR'),
          orElse: () => Flavor.dev,
        ),
        apiBaseUrl: const String.fromEnvironment(
          'API_BASE_URL',
          defaultValue: 'http://localhost:18085',
        ),
        sentryDsn: const String.fromEnvironment('SENTRY_DSN'),
        sentryTracesSampleRate: double.tryParse(
              const String.fromEnvironment('SENTRY_TRACES_SAMPLE_RATE'),
            ) ??
            0.0,
        analyticsEnabled: const bool.fromEnvironment(
          'ANALYTICS_ENABLED',
          defaultValue: false,
        ),
        appVersion: const String.fromEnvironment(
          'APP_VERSION',
          defaultValue: '0.1.0',
        ),
        buildNumber: const String.fromEnvironment(
          'BUILD_NUMBER',
          defaultValue: '1',
        ),
        pushEnabled: const bool.fromEnvironment(
          'PUSH_ENABLED',
          defaultValue: false,
        ),
      );
}
