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
