import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mobile/core/config/app_config.dart';
import 'package:cms_mobile/core/error/app_error.dart';
import 'package:cms_mobile/core/network/dio_client.dart';
import 'package:cms_mobile/core/network/envelope_interceptor.dart';

/// 计数假适配器:记录每次调用并按调用序号返回脚本化结果。
class _CountingAdapter implements HttpClientAdapter {
  _CountingAdapter(this._handler);

  final Future<ResponseBody> Function(int callIndex, RequestOptions options)
      _handler;

  int calls = 0;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) {
    calls++;
    requests.add(options);
    return _handler(calls, options);
  }

  @override
  void close({bool force = false}) {}
}

const Map<String, List<String>> _jsonHeaders = <String, List<String>>{
  'content-type': <String>['application/json; charset=utf-8'],
};

ResponseBody _okBody() => ResponseBody.fromString(
      jsonEncode(<String, Object?>{
        'code': 200,
        'message': 'ok',
        'data': <String, Object?>{'ok': true},
      }),
      200,
      headers: _jsonHeaders,
    );

Future<ResponseBody> _timeout(RequestOptions options) async =>
    throw DioException.connectionTimeout(
      timeout: const Duration(milliseconds: 10),
      requestOptions: options,
    );

AppConfig _testConfig() => const AppConfig(
      flavor: Flavor.dev,
      apiBaseUrl: 'http://test.local',
      sentryDsn: '',
      sentryTracesSampleRate: 0,
      analyticsEnabled: false,
      appVersion: '0.1.0',
      buildNumber: '1',
      pushEnabled: false,
    );

Dio _dioWith(_CountingAdapter adapter, {bool enableRetry = true}) {
  final Dio dio = buildDio(_testConfig(), enableRetry: enableRetry);
  dio.httpClientAdapter = adapter;
  return dio;
}

Future<AppError> _caughtAppError(Future<Response<dynamic>> Function() send) async {
  try {
    await dioCall<dynamic>(send);
  } on AppError catch (e) {
    return e;
  }
  fail('应当抛出 AppError');
}

void main() {
  group('RetryInterceptor', () {
    test('GET 传输失败后重试一次成功', () async {
      final _CountingAdapter adapter =
          _CountingAdapter((call, options) async {
        if (call == 1) {
          return _timeout(options);
        }
        return _okBody();
      });
      final Dio dio = _dioWith(adapter);

      final Response<dynamic> res =
          await dioCall<dynamic>(() => dio.get<dynamic>('/api/app/ping'));

      expect(res.data, <String, dynamic>{'ok': true});
      expect(adapter.calls, 2);
      // 重放的是原请求。
      expect(adapter.requests[1].method, adapter.requests[0].method);
      expect(adapter.requests[1].path, adapter.requests[0].path);
    });

    test('GET 连续失败只重试一次(上限 1)', () async {
      final _CountingAdapter adapter =
          _CountingAdapter((call, options) => _timeout(options));
      final Dio dio = _dioWith(adapter);

      final AppError err = await _caughtAppError(
        () => dio.get<dynamic>('/api/app/ping'),
      );

      expect(adapter.calls, 2);
      // 超时最终由信封拦截器归一为网络失败。
      expect(err.code, 0);
      expect(err.message, kNetworkErrorMessage);
    });

    test('GET 遇 SocketException 也重试', () async {
      final _CountingAdapter adapter =
          _CountingAdapter((call, options) async {
        if (call == 1) {
          throw const SocketException('connection reset');
        }
        return _okBody();
      });
      final Dio dio = _dioWith(adapter);

      final Response<dynamic> res =
          await dioCall<dynamic>(() => dio.get<dynamic>('/api/app/ping'));

      expect(res.data, <String, dynamic>{'ok': true});
      expect(adapter.calls, 2);
    });

    test('POST 传输失败不重试(仅幂等 GET)', () async {
      final _CountingAdapter adapter =
          _CountingAdapter((call, options) => _timeout(options));
      final Dio dio = _dioWith(adapter);

      await _caughtAppError(() => dio.post<dynamic>('/api/app/ping'));

      expect(adapter.calls, 1);
    });

    test('GET 收到 HTTP 500 不重试(已有明确应答)', () async {
      final _CountingAdapter adapter = _CountingAdapter(
        (_, __) async => ResponseBody.fromString(
          jsonEncode(<String, Object?>{'code': 500, 'message': 'internal'}),
          500,
          headers: _jsonHeaders,
        ),
      );
      final Dio dio = _dioWith(adapter);

      final AppError err =
          await _caughtAppError(() => dio.get<dynamic>('/api/app/ping'));

      expect(adapter.calls, 1);
      expect(err.code, 500);
      expect(err.message, '服务暂时不可用,请稍后重试');
    });

    test('GET 遇信封业务错误不重试', () async {
      final _CountingAdapter adapter = _CountingAdapter(
        (_, __) async => ResponseBody.fromString(
          jsonEncode(<String, Object?>{
            'code': 500,
            'message': 'boom',
            'logID': 'log-3',
          }),
          200,
          headers: _jsonHeaders,
        ),
      );
      final Dio dio = _dioWith(adapter);

      final AppError err =
          await _caughtAppError(() => dio.get<dynamic>('/api/app/ping'));

      expect(adapter.calls, 1);
      expect(err.code, 500);
      expect(err.message, 'boom');
      expect(err.logID, 'log-3');
    });

    test('enableRetry:false 关闭重试', () async {
      final _CountingAdapter adapter =
          _CountingAdapter((call, options) => _timeout(options));
      final Dio dio = _dioWith(adapter, enableRetry: false);

      await _caughtAppError(() => dio.get<dynamic>('/api/app/ping'));

      expect(adapter.calls, 1);
    });
  });
}
