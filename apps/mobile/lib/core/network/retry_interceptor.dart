import 'dart:io';

import 'package:dio/dio.dart';

/// 重试拦截器:只对幂等 GET 做传输层失败重试,默认上限 1 次,指数退避。
///
/// 只重试瞬时传输层失败(连接/发送/接收超时、连接错误、SocketException 等
/// IO 异常);不重试已有明确应答的失败(HTTP 4xx/5xx、信封业务错误)与取消。
class RetryInterceptor extends Interceptor {
  RetryInterceptor(
    this._dio, {
    this.maxRetries = 1,
    this.initialBackoff = const Duration(milliseconds: 500),
  });

  static const String _attemptsKey = 'cms.retry.attempts';

  final Dio _dio;

  /// 重试上限;设 0 即关闭重试。
  final int maxRetries;

  /// 首次重试前的等待;第 n 次重试(从 0 计)等待 initialBackoff * 2^n(指数退避)。
  final Duration initialBackoff;

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    final RequestOptions options = err.requestOptions;
    final int attempt = options.extra[_attemptsKey] as int? ?? 0;

    final bool isGet = options.method.toUpperCase() == 'GET';
    if (!isGet || attempt >= maxRetries || !_isTransientFailure(err)) {
      handler.next(err);
      return;
    }

    // 计数记在原请求 extra 上,重放时内层链路据此不再重试,保证只重试一次。
    options.extra[_attemptsKey] = attempt + 1;
    try {
      await Future<void>.delayed(_backoff(attempt));
      final Response<dynamic> response = await _dio.fetch<dynamic>(options);
      handler.resolve(response);
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  Duration _backoff(int attempt) {
    var delay = initialBackoff;
    for (var i = 0; i < attempt; i++) {
      delay = delay * 2;
    }
    return delay;
  }

  bool _isTransientFailure(DioException err) {
    switch (err.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.transformTimeout:
      case DioExceptionType.connectionError:
        return true;
      case DioExceptionType.unknown:
        // 适配器抛出的裸 IO 异常(SocketException 等)会被 dio 包成 unknown。
        return err.error is IOException;
      case DioExceptionType.badResponse:
      case DioExceptionType.badCertificate:
      case DioExceptionType.cancel:
        return false;
    }
  }
}
