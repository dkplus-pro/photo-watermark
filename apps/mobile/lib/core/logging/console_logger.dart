import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';

import '../config/app_config.dart';
import '../error/error_reporter.dart';
import 'app_logger.dart';

/// AppLogger 默认实现:debugPrint 输出(VM/真机均可见),ERROR 级同时转发 ErrorReporter。
class ConsoleLogger implements AppLogger {
  const ConsoleLogger({required this.errorReporter});

  final ErrorReporter errorReporter;

  void _log(String level, String message, Object? error, Map<String, Object?>? context) {
    final suffix = context == null || context.isEmpty ? '' : ' $context';
    developer.log('$message$suffix', name: level);
    if (kDebugMode) {
      debugPrint('[$level] $message$suffix');
      if (error != null) {
        debugPrint('[$level] error: $error');
      }
    }
  }

  @override
  void debug(String message, {Map<String, Object?>? context}) =>
      _log('debug', message, null, context);

  @override
  void info(String message, {Map<String, Object?>? context}) =>
      _log('info', message, null, context);

  @override
  void warn(String message, {Object? error, Map<String, Object?>? context}) =>
      _log('warn', message, error, context);

  @override
  void error(
    String message, {
    Object? error,
    StackTrace? stackTrace,
    Map<String, Object?>? context,
  }) {
    _log('error', message, error, context);
    // ERROR 级自动挂接 ErrorReporter(接口契约,见 app_logger.dart)
    errorReporter.captureError(error ?? message, stackTrace: stackTrace, context: context);
  }
}

/// 按 AppConfig 组装 Logger(M3.1 装配用):reporter 由 overrides 注入。
ConsoleLogger buildAppLogger(AppConfig config, ErrorReporter reporter) =>
    ConsoleLogger(errorReporter: reporter);
