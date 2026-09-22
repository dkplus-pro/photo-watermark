// RequestLogInterceptor + dioCall 取消归一单测(方案 §4.2 RL1–RL8):
// logger 用 Fake 记录调用;handler 用 dio 真实 handler 的 spy 子类记录 next 调用,
// 不触真实网络。RL8(既有 network_dio_client_test.dart 的 3 组 dioCall 用例不改
// 不动、全绿)由该文件承担回归,不在本文件重复。
//
// 实现说明:方案锁定「自定义 _SpyXxxHandler implements handler 记录 next 调用」,
// 但 dio 5.11.1 的 handler 公开接口含 `_BaseHandler.future`
// (返回类型为未导出的 InterceptorState),纯 implements 无法编译,故按同一
// 行为形态改用 extends + 覆写 next 记录调用(不调 super,不驱动真实管道——
// ErrorInterceptorHandler.next 会 completeError,无监听者会成未处理异步错误)。
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mobile/core/error/app_error.dart';
import 'package:cms_mobile/core/logging/app_logger.dart';
import 'package:cms_mobile/core/network/dio_client.dart';
import 'package:cms_mobile/core/network/envelope_interceptor.dart';
import 'package:cms_mobile/core/network/request_log_interceptor.dart';

/// 记录一次日志调用的形态。
class _LogCall {
  const _LogCall(this.level, this.message, this.error, this.context);

  final String level;
  final String message;
  final Object? error;
  final Map<String, Object?>? context;
}

/// AppLogger 假实现:按级别记录全部调用,不产生任何输出。
class _FakeAppLogger implements AppLogger {
  final List<_LogCall> calls = <_LogCall>[];

  List<_LogCall> byLevel(String level) =>
      calls.where((_LogCall call) => call.level == level).toList();

  @override
  void debug(String message, {Map<String, Object?>? context}) =>
      calls.add(_LogCall('debug', message, null, context));

  @override
  void info(String message, {Map<String, Object?>? context}) =>
      calls.add(_LogCall('info', message, null, context));

  @override
  void warn(String message, {Object? error, Map<String, Object?>? context}) =>
      calls.add(_LogCall('warn', message, error, context));

  @override
  void error(
    String message, {
    Object? error,
    StackTrace? stackTrace,
    Map<String, Object?>? context,
  }) =>
      calls.add(_LogCall('error', message, error, context));
}

class _SpyRequestHandler extends RequestInterceptorHandler {
  int nextCalls = 0;

  @override
  void next(RequestOptions options) {
    nextCalls += 1;
  }
}

class _SpyResponseHandler extends ResponseInterceptorHandler {
  int nextCalls = 0;

  @override
  void next(Response response) {
    nextCalls += 1;
  }
}

class _SpyErrorHandler extends ErrorInterceptorHandler {
  int nextCalls = 0;

  @override
  void next(DioException error) {
    nextCalls += 1;
  }
}

void main() {
  group('RequestLogInterceptor', () {
    test('verbose 记全量请求/响应 debug 日志(RL1)', () {
      final logger = _FakeAppLogger();
      final interceptor = RequestLogInterceptor(logger: logger, verbose: true);

      final options = RequestOptions(path: '/api/app/ping', method: 'GET');
      final requestHandler = _SpyRequestHandler();
      interceptor.onRequest(options, requestHandler);

      expect(requestHandler.nextCalls, 1);
      final requestCalls = logger.byLevel('debug');
      expect(requestCalls, hasLength(1));
      expect(requestCalls.single.message, 'HTTP 请求');
      expect(requestCalls.single.context, <String, Object?>{
        'method': 'GET',
        'url': options.uri.toString(),
      });

      final response = Response<dynamic>(
        requestOptions: options,
        statusCode: 200,
      );
      final responseHandler = _SpyResponseHandler();
      interceptor.onResponse(response, responseHandler);

      expect(responseHandler.nextCalls, 1);
      final responseCalls = logger.byLevel('debug');
      expect(responseCalls, hasLength(2));
      final context = responseCalls.last.context!;
      expect(responseCalls.last.message, 'HTTP 响应');
      expect(context['method'], 'GET');
      expect(context['url'], options.uri.toString());
      expect(context['statusCode'], 200);
      expect(context.containsKey('durationMs'), isTrue);
      expect(context['durationMs'], greaterThanOrEqualTo(0));
    });

    test('verbose=false onRequest/onResponse 零日志,管道照常放行(RL2)', () {
      final logger = _FakeAppLogger();
      final interceptor = RequestLogInterceptor(logger: logger, verbose: false);

      final options = RequestOptions(path: '/x', method: 'GET');
      final requestHandler = _SpyRequestHandler();
      interceptor.onRequest(options, requestHandler);
      final responseHandler = _SpyResponseHandler();
      interceptor.onResponse(
        Response<dynamic>(requestOptions: options, statusCode: 200),
        responseHandler,
      );

      expect(logger.calls, isEmpty);
      expect(requestHandler.nextCalls, 1);
      expect(responseHandler.nextCalls, 1);
    });

    test('onError 必记 error 日志并透传 AppError 本体(RL3)', () {
      final logger = _FakeAppLogger();
      final interceptor = RequestLogInterceptor(logger: logger, verbose: false);

      const appError = AppError(code: 500, message: 'boom');
      final options = RequestOptions(path: '/x', method: 'POST');
      final err = DioException(
        requestOptions: options,
        response: Response<dynamic>(requestOptions: options, statusCode: 500),
        type: DioExceptionType.badResponse,
        error: appError,
      );
      final handler = _SpyErrorHandler();
      interceptor.onError(err, handler);

      expect(handler.nextCalls, 1);
      expect(logger.calls, hasLength(1));
      final call = logger.calls.single;
      expect(call.level, 'error');
      expect(call.message, 'HTTP 请求失败');
      expect(call.error, same(appError));
      expect(call.context!['method'], 'POST');
      expect(call.context!['url'], options.uri.toString());
      expect(call.context!['statusCode'], 500);
    });

    test('未过 onRequest 的响应无 durationMs 键且不抛(RL4)', () {
      final logger = _FakeAppLogger();
      final interceptor = RequestLogInterceptor(logger: logger, verbose: true);

      final options = RequestOptions(path: '/x', method: 'GET');
      final responseHandler = _SpyResponseHandler();
      interceptor.onResponse(
        Response<dynamic>(requestOptions: options, statusCode: 200),
        responseHandler,
      );

      expect(responseHandler.nextCalls, 1);
      final context = logger.calls.single.context!;
      expect(context.containsKey('durationMs'), isFalse);
      expect(context['method'], 'GET');
      expect(context['url'], options.uri.toString());
      expect(context['statusCode'], 200);
    });

    test('三方法均把 handler.next 恰好调一次,verbose 两档一致(RL5)', () {
      final logger = _FakeAppLogger();

      for (final verbose in <bool>[true, false]) {
        final interceptor = RequestLogInterceptor(
          logger: logger,
          verbose: verbose,
        );
        final options = RequestOptions(path: '/x', method: 'GET');

        final requestHandler = _SpyRequestHandler();
        interceptor.onRequest(options, requestHandler);
        final responseHandler = _SpyResponseHandler();
        interceptor.onResponse(
          Response<dynamic>(requestOptions: options, statusCode: 200),
          responseHandler,
        );
        final errorHandler = _SpyErrorHandler();
        interceptor.onError(
          DioException(requestOptions: options, error: 'raw'),
          errorHandler,
        );

        expect(requestHandler.nextCalls, 1);
        expect(responseHandler.nextCalls, 1);
        expect(errorHandler.nextCalls, 1);
      }
    });
  });

  group('dioCall 取消归一', () {
    test('DioExceptionType.cancel 归一为 AppError(-1)(RL6)', () async {
      // 信封拦截器会把取消包成网络失败 AppError,这里以该形态冒出。
      await expectLater(
        dioCall<dynamic>(
          () => Future<Response<dynamic>>.error(
            DioException(
              requestOptions: RequestOptions(path: '/x'),
              type: DioExceptionType.cancel,
              error: const AppError(code: 0, message: kNetworkErrorMessage),
            ),
          ),
        ),
        throwsA(
          isA<AppError>()
              .having((AppError e) => e.code, 'code', kCancelledErrorCode)
              .having(
                (AppError e) => e.message,
                'message',
                kRequestCancelledMessage,
              ),
        ),
      );
    });

    test('cancelToken 已取消时按 token 状态归一为取消(RL7)', () async {
      final token = CancelToken()..cancel();

      await expectLater(
        dioCall<dynamic>(
          () => Future<Response<dynamic>>.error(
            DioException(
              requestOptions: RequestOptions(path: '/x'),
              type: DioExceptionType.unknown,
              error: 'raw',
            ),
          ),
          cancelToken: token,
        ),
        throwsA(
          isA<AppError>().having(
            (AppError e) => e.code,
            'code',
            kCancelledErrorCode,
          ),
        ),
      );
    });
  });
}
