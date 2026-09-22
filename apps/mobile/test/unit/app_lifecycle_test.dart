// AppLifecycleService 单测(方案 §4.3 LC1–LC7):
// tracker/logger 用 Fake 记录调用;状态入口直接调 handle,不模拟真实前后台切换;
// start/dispose 走真实 WidgetsBinding 注册(ensureInitialized 后幂等可用)。
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mobile/core/analytics/event_tracker.dart';
import 'package:cms_mobile/core/lifecycle/app_lifecycle.dart';
import 'package:cms_mobile/core/logging/app_logger.dart';

/// EventTracker 替身:只记录 track 的事件名序列。
class _FakeEventTracker implements EventTracker {
  final List<String> events = <String>[];

  @override
  void pageView(String path, {Map<String, Object?>? properties}) {}

  @override
  void track(String name, {Map<String, Object?>? properties}) {
    events.add(name);
  }

  @override
  void expose(String trackId, {Map<String, Object?>? properties}) {
    events.add('expose');
  }
}

/// AppLogger 替身:只记录 warn 消息(LC6 用)。
class _FakeAppLogger implements AppLogger {
  final List<String> warnMessages = <String>[];

  @override
  void debug(String message, {Map<String, Object?>? context}) {}

  @override
  void info(String message, {Map<String, Object?>? context}) {}

  @override
  void warn(String message, {Object? error, Map<String, Object?>? context}) {
    warnMessages.add(message);
  }

  @override
  void error(
    String message, {
    Object? error,
    StackTrace? stackTrace,
    Map<String, Object?>? context,
  }) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('lifecycleEventFor', () {
    test('resumed/paused 产生事件,中间态返回 null(LC1)', () {
      expect(lifecycleEventFor(AppLifecycleState.resumed), kAppForegroundEvent);
      expect(
        lifecycleEventFor(AppLifecycleState.paused),
        kAppBackgroundEvent,
      );
      expect(lifecycleEventFor(AppLifecycleState.inactive), isNull);
      expect(lifecycleEventFor(AppLifecycleState.hidden), isNull);
      expect(lifecycleEventFor(AppLifecycleState.detached), isNull);
    });
  });

  group('AppLifecycleService', () {
    test('事件序列 resumed→paused→resumed 逐次上报(LC2)', () {
      final tracker = _FakeEventTracker();
      final service = AppLifecycleService(tracker: tracker);

      service
        ..handle(AppLifecycleState.resumed)
        ..handle(AppLifecycleState.paused)
        ..handle(AppLifecycleState.resumed);

      expect(
        tracker.events,
        <String>[
          kAppForegroundEvent,
          kAppBackgroundEvent,
          kAppForegroundEvent,
        ],
      );
    });

    test('同态去重:连续 paused 只报一次(LC3)', () {
      final tracker = _FakeEventTracker();
      final service = AppLifecycleService(tracker: tracker);

      service
        ..handle(AppLifecycleState.paused)
        ..handle(AppLifecycleState.paused);

      expect(tracker.events, <String>[kAppBackgroundEvent]);
    });

    test('中间态不产生事件(LC4)', () {
      final tracker = _FakeEventTracker();
      final service = AppLifecycleService(tracker: tracker);

      service.handle(AppLifecycleState.inactive);

      expect(tracker.events, isEmpty);
    });

    test('切后台触发 flush 挂点,回前台不触发;null 挂点不抛(LC5)', () {
      var backgroundCalls = 0;
      final service = AppLifecycleService(
        tracker: _FakeEventTracker(),
        onBackground: () => backgroundCalls++,
      );

      service.handle(AppLifecycleState.resumed);
      expect(backgroundCalls, 0);
      service.handle(AppLifecycleState.paused);
      expect(backgroundCalls, 1);

      final nullHookService = AppLifecycleService(tracker: _FakeEventTracker());
      expect(
        () => nullHookService.handle(AppLifecycleState.paused),
        returnsNormally,
      );
    });

    test('挂点抛错被吞:logger.warn 一次,事件仍已上报(LC6)', () {
      final tracker = _FakeEventTracker();
      final logger = _FakeAppLogger();
      final service = AppLifecycleService(
        tracker: tracker,
        logger: logger,
        onBackground: () => throw StateError('flush failed'),
      );

      expect(() => service.handle(AppLifecycleState.paused), returnsNormally);

      expect(tracker.events, <String>[kAppBackgroundEvent]);
      expect(logger.warnMessages, hasLength(1));
    });

    test('start/dispose 幂等;dispose 后 handle 仍可用(LC7)', () {
      final tracker = _FakeEventTracker();
      final service = AppLifecycleService(tracker: tracker);

      service
        ..start()
        ..start()
        ..dispose()
        ..dispose();

      // 纯逻辑路径不受注册态影响。
      service.handle(AppLifecycleState.resumed);

      expect(tracker.events, <String>[kAppForegroundEvent]);
    });
  });
}
