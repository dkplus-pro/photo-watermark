// M2.B 监控三件套单测:Fake 验证调用契约(方案 §4 阶段 2.B 边界)。
// 覆盖:DSN 缺失 no-op(SentryErrorReporter/Sentry* 不初始化语义)、
// 字段透传、ERROR 日志挂接 ErrorReporter、KeyValueStore 读写/删除/包含。
import 'package:cms_mobile/core/analytics/event_tracker_impls.dart';
import 'package:cms_mobile/core/config/app_config.dart';
import 'package:cms_mobile/core/error/error_reporter.dart';
import 'package:cms_mobile/core/error/sentry_error_reporter.dart';
import 'package:cms_mobile/core/logging/app_logger.dart';
import 'package:cms_mobile/core/logging/console_logger.dart';
import 'package:cms_mobile/core/monitoring/sentry_performance_monitor.dart';
import 'package:cms_mobile/core/storage/key_value_store.dart';
import 'package:cms_mobile/core/storage/shared_preferences_key_value_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 记录型 Fake Reporter(测试替身,helpers 亦复用)。
class FakeErrorReporter implements ErrorReporter {
  final List<(Object?, StackTrace?, Map<String, Object?>?)> errors = [];
  final List<(String, Map<String, Object?>?)> messages = [];

  @override
  void captureError(Object error,
      {StackTrace? stackTrace, Map<String, Object?>? context}) {
    errors.add((error, stackTrace, context));
  }

  @override
  void captureMessage(String message, {Map<String, Object?>? context}) {
    messages.add((message, context));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('NoopErrorReporter(SentryErrorReporter 的降级语义)', () {
    test('调用不抛错、零副作用', () {
      const reporter = NoopErrorReporter();
      reporter.captureError(StateError('x'), context: {'k': 'v'});
      reporter.captureMessage('m');
      // 无断言目标:不抛错即通过(no-op 契约)
    });
  });

  group('SentryErrorReporter(未初始化 Sentry 时的安全语义)', () {
    test('未 init 时调用不抛错(Sentry 内部安全)', () {
      const reporter = SentryErrorReporter();
      reporter.captureError(StateError('boom'));
      reporter.captureMessage('msg', context: {'k': 'v'});
    });
  });

  group('NoopPerformanceMonitor', () {
    test('startTrace 恒返回 null(未启用语义)', () {
      const monitor = NoopPerformanceMonitor();
      expect(monitor.startTrace('app.launch'), isNull);
    });
  });

  group('ConsoleLogger(ERROR 挂接 ErrorReporter)', () {
    test('error 级转发 ErrorReporter,字段透传', () {
      final fake = FakeErrorReporter();
      final AppLogger logger = ConsoleLogger(errorReporter: fake);
      final stack = StackTrace.current;
      logger.error('boom', error: StateError('x'), stackTrace: stack, context: {'k': 'v'});
      expect(fake.errors, hasLength(1));
      final (err, stackTrace, context) = fake.errors.single;
      expect(err, isA<StateError>());
      expect(stackTrace, same(stack));
      expect(context, {'k': 'v'});
    });
    test('非 error 级不转发', () {
      final fake = FakeErrorReporter();
      final AppLogger logger = ConsoleLogger(errorReporter: fake);
      logger.info('hello');
      logger.warn('careful', error: 'e');
      logger.debug('dbg');
      expect(fake.errors, isEmpty);
    });
  });

  group('buildEventTracker(按 analyticsEnabled 选实现)', () {
    test('关闭 → Console 实现;开启 → Sentry 实现', () {
      final config = AppConfig.fromDartDefines();
      expect(buildEventTracker(config), isA<ConsoleEventTracker>());
      expect(
        buildEventTracker(
          AppConfig(
            flavor: Flavor.dev,
            apiBaseUrl: 'http://localhost:18085',
            sentryDsn: '',
            sentryTracesSampleRate: 0,
            analyticsEnabled: true,
            appVersion: '0.1.0',
            buildNumber: '1',
            pushEnabled: false,
          ),
        ),
        isA<SentryEventTracker>(),
      );
    });
    test('Console 实现调用不抛错', () {
      const tracker = ConsoleEventTracker();
      tracker.pageView('/home');
      tracker.track('app.launch', properties: {'ok': true});
    });
  });

  group('SharedPreferencesKeyValueStore', () {
    late KeyValueStore store;

    setUp(() {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      store = SharedPreferencesKeyValueStore();
    });

    test('set/get/remove/containsKey 往返', () async {
      expect(await store.containsKey('k'), isFalse);
      expect(await store.getString('k'), isNull);
      await store.setString('k', 'v');
      expect(await store.getString('k'), 'v');
      expect(await store.containsKey('k'), isTrue);
      await store.remove('k');
      expect(await store.getString('k'), isNull);
      expect(await store.containsKey('k'), isFalse);
    });
    test('覆盖写:后写生效(非法状态迁移边界)', () async {
      await store.setString('k', 'a');
      await store.setString('k', 'b');
      expect(await store.getString('k'), 'b');
    });
    test('remove 不存在的 key 安全', () async {
      await store.remove('nope');
      expect(await store.containsKey('nope'), isFalse);
    });
  });
}
