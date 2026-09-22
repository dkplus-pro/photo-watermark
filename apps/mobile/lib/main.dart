import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'app.dart';
import 'app_providers.dart';
import 'core/analytics/event_tracker_impls.dart';
import 'core/monitoring/sentry_performance_monitor.dart';
import 'core/logging/console_logger.dart';
import 'core/config/app_config.dart';
import 'core/error/error_reporter.dart';
import 'core/error/sentry_error_reporter.dart';

void main() {
  // runZonedGuarded 收口三大异常入口(方案 §4 阶段 3.1):
  // 1) zone 内未捕获异常;2) FlutterError.onError(框架/布局异常);3) PlatformDispatcher.onError。
  // 三者统一转发 ErrorReporter;Sentry 是否真实上报由 DSN 决定(缺失时 Noop)。
  runZonedGuarded<Future<void>>(
    () async {
      final config = AppConfig.fromDartDefines();
      final reporter = resolveErrorReporter(config);

      WidgetsFlutterBinding.ensureInitialized();

      FlutterError.onError = (details) {
        FlutterError.presentError(details);
        reporter.captureError(details.exception, stackTrace: details.stack);
      };
      PlatformDispatcher.instance.onError = (error, stack) {
        reporter.captureError(error, stackTrace: stack);
        return true;
      };

      if (config.sentryDsn.isNotEmpty) {
        await SentryFlutter.init(
          (options) {
            options.dsn = config.sentryDsn;
            options.tracesSampleRate = config.sentryTracesSampleRate;
          },
        );
      }

      runApp(
        ProviderScope(
          // 装配:按 dart-define 选择 core 实现(Override 类型未公开,内联组装)
          overrides: [
            appConfigProvider.overrideWithValue(config),
            errorReporterProvider.overrideWithValue(reporter),
            performanceMonitorProvider.overrideWithValue(
              config.sentryDsn.isEmpty || config.sentryTracesSampleRate <= 0
                  ? const NoopPerformanceMonitor()
                  : const SentryPerformanceMonitor(),
            ),
            eventTrackerProvider.overrideWithValue(buildEventTracker(config)),
            appLoggerProvider.overrideWithValue(
              ConsoleLogger(errorReporter: reporter),
            ),
          ],
          child: const CmsMobileApp(),
        ),
      );
    },
    (error, stack) {
      // zone 回调里拿不到 container,复用同一选型逻辑(与 overrides 一致)。
      resolveErrorReporter(AppConfig.fromDartDefines()).captureError(
        error,
        stackTrace: stack,
      );
    },
  );
}

ErrorReporter resolveErrorReporter(AppConfig config) {
  return config.sentryDsn.isEmpty
      ? const NoopErrorReporter()
      : const SentryErrorReporter();
}
