/// 性能监控抽象:Sentry 实现(M2.B),DSN/采样率缺失返回 Noop。
/// 典型事务:应用启动(M3.1)、路由级(路由表接线时)。
abstract interface class PerformanceMonitor {
  /// 开启命名 trace;返回 null 表示当前实现未启用,调用方无需空转。
  TraceHandle? startTrace(String name, {Map<String, String>? attributes});
}

/// 单个 trace 的句柄;stop 后不再累计耗时。
abstract interface class TraceHandle {
  void putAttribute(String key, String value);

  void stop();
}
