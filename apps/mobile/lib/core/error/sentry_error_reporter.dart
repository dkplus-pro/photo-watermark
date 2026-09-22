import 'package:sentry_flutter/sentry_flutter.dart';

import 'error_reporter.dart';

/// ErrorReporter 的 Noop 实现:DSN 缺失时经 ProviderScope override 替换(M3.1),
/// 业务零感知。所有方法均为空操作。
class NoopErrorReporter implements ErrorReporter {
  const NoopErrorReporter();

  @override
  void captureError(Object error, {StackTrace? stackTrace, Map<String, Object?>? context}) {}

  @override
  void captureMessage(String message, {Map<String, Object?>? context}) {}
}

/// ErrorReporter 的 Sentry 实现:透传 error/stack/context(Sentry scope 附加)。
/// DSN 由 AppConfig.sentryDsn 决定(M3.1 装配),本实现不重复判断。
class SentryErrorReporter implements ErrorReporter {
  const SentryErrorReporter();

  @override
  void captureError(
    Object error, {
    StackTrace? stackTrace,
    Map<String, Object?>? context,
  }) {
    // Sentry 自身吞掉上报失败(内部 try/catch),这里不感知网络错误
    Sentry.captureException(error, stackTrace: stackTrace, withScope: (scope) {
      context?.forEach((key, value) => scope.setTag(key, value.toString()));
    });
  }

  @override
  void captureMessage(String message, {Map<String, Object?>? context}) {
    Sentry.captureMessage(message, withScope: (scope) {
      context?.forEach((key, value) => scope.setTag(key, value.toString()));
    });
  }
}
