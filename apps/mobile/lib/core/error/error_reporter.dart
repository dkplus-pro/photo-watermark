/// 错误上报抽象:Sentry 默认实现(M2.B);DSN 缺失时以 NoopErrorReporter 替换
/// (provider override 即配置坑,业务零感知)。所有未捕获异常经 runZonedGuarded
/// 收口到本接口(M3.1 装配)。
abstract interface class ErrorReporter {
  void captureError(
    Object error, {
    StackTrace? stackTrace,
    Map<String, Object?>? context,
  });

  void captureMessage(String message, {Map<String, Object?>? context});
}
