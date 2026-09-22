import 'package:flutter/foundation.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import '../config/app_config.dart';
import 'event_tracker.dart';

/// 事件埋点抽象的默认实现(AppConfig.analyticsEnabled=false 时业务拿到的实例)。
/// 输出走 debugPrint,便于开发期肉眼核对;release 构建不产生噪音(analyticsEnabled=false)。
class ConsoleEventTracker implements EventTracker {
  const ConsoleEventTracker();

  @override
  void pageView(String path, {Map<String, Object?>? properties}) {
    debugPrint('[track] page_view: $path ${properties ?? const {}}');
  }

  @override
  void track(String name, {Map<String, Object?>? properties}) {
    debugPrint('[track] $name ${properties ?? const {}}');
  }

  @override
  void expose(String trackId, {Map<String, Object?>? properties}) =>
      track('expose', properties: {'trackId': trackId, ...?properties});
}

/// EventTracker 的 Sentry 实现:埋点走 Sentry breadcrumb(不占事件配额)。
class SentryEventTracker implements EventTracker {
  const SentryEventTracker();

  @override
  void pageView(String path, {Map<String, Object?>? properties}) {
    Sentry.addBreadcrumb(
      Breadcrumb(
          message: 'page_view: $path',
          data: properties,
          category: 'navigation'),
    );
  }

  @override
  void track(String name, {Map<String, Object?>? properties}) {
    Sentry.addBreadcrumb(
        Breadcrumb(message: name, data: properties, category: 'track'));
  }

  @override
  void expose(String trackId, {Map<String, Object?>? properties}) =>
      track('expose', properties: {'trackId': trackId, ...?properties});
}

/// 按配置选择埋点实现:M2.B 工厂;M3.1 经 ProviderScope override 最终装配。
EventTracker buildEventTracker(AppConfig config) {
  return config.analyticsEnabled
      ? const SentryEventTracker()
      : const ConsoleEventTracker();
}
