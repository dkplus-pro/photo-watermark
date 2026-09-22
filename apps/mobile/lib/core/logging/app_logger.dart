/// 分级日志抽象:ERROR 级实现体须自动挂接 ErrorReporter(M2.B 实现)。
/// 业务代码禁止裸 `print`/`debugPrint`,统一经注入的 AppLogger 输出。
abstract interface class AppLogger {
  void debug(String message, {Map<String, Object?>? context});

  void info(String message, {Map<String, Object?>? context});

  void warn(String message, {Object? error, Map<String, Object?>? context});

  void error(
    String message, {
    Object? error,
    StackTrace? stackTrace,
    Map<String, Object?>? context,
  });
}
