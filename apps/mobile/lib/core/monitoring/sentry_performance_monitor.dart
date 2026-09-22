import 'package:sentry_flutter/sentry_flutter.dart';

import 'performance_monitor.dart';

/// PerformanceMonitor 的 Noop 实现:DSN/采样率未启用时使用,startTrace 恒返回 null。
class NoopPerformanceMonitor implements PerformanceMonitor {
  const NoopPerformanceMonitor();

  @override
  TraceHandle? startTrace(String name, {Map<String, String>? attributes}) => null;
}

/// PerformanceMonitor 的 Sentry 实现:startTrace 开启 Sentry 事务(span 语义)。
class SentryPerformanceMonitor implements PerformanceMonitor {
  const SentryPerformanceMonitor();

  @override
  TraceHandle? startTrace(String name, {Map<String, String>? attributes}) {
    // Sentry 未初始化时(Noop 集成)内部安全返回,这里不重复判 DSN
    final span = Sentry.startTransaction(name, 'task', customSamplingContext: attributes);
    return SentryTraceHandle(span);
  }
}

/// Sentry span 的句柄封装:putAttribute → setTag,stop → finish。
class SentryTraceHandle implements TraceHandle {
  SentryTraceHandle(this._span);

  final ISentrySpan _span;

  @override
  void putAttribute(String key, String value) {
    _span.setTag(key, value);
  }

  @override
  void stop() {
    _span.finish();
  }
}
