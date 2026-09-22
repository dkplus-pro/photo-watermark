import 'package:dio/dio.dart';

import 'package:cms_mobile/core/logging/app_logger.dart';

/// 请求起始时间戳在 RequestOptions.extra 上的键。
const String kRequestLogStartMsKey = 'cms.requestLog.startMs';

/// 请求日志拦截器:verbose(dev/staging)记全量 debug 日志;非 verbose(prod)只记错误。
/// 装配在信封拦截器之后(buildDio additionalInterceptors),onError 看到的已是归一后的 AppError。
class RequestLogInterceptor extends Interceptor {
  const RequestLogInterceptor({required this.logger, required this.verbose});

  final AppLogger logger;

  /// true = 记请求/响应 debug 日志;false = 只记 error。
  final bool verbose;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.extra[kRequestLogStartMsKey] =
        DateTime.now().millisecondsSinceEpoch;
    if (verbose) {
      logger.debug(
        'HTTP 请求',
        context: <String, Object?>{
          'method': options.method,
          'url': options.uri.toString(),
        },
      );
    }
    handler.next(options);
  }

  @override
  void onResponse(
      Response<dynamic> response, ResponseInterceptorHandler handler) {
    if (verbose) {
      logger.debug(
        'HTTP 响应',
        context: _contextOf(response.requestOptions)
          ..['statusCode'] = response.statusCode ?? 0,
      );
    }
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    logger.error(
      'HTTP 请求失败',
      error: err.error ?? err,
      context: _contextOf(err.requestOptions)
        ..['statusCode'] = err.response?.statusCode ?? 0,
    );
    handler.next(err);
  }

  Map<String, Object?> _contextOf(RequestOptions options) {
    final context = <String, Object?>{
      'method': options.method,
      'url': options.uri.toString(),
    };
    final startMs = options.extra[kRequestLogStartMsKey];
    if (startMs is int) {
      context['durationMs'] = DateTime.now().millisecondsSinceEpoch - startMs;
    }
    return context;
  }
}
