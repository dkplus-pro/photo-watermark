import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mobile/core/config/app_config.dart';
import 'package:cms_mobile/core/error/app_error.dart';
import 'package:cms_mobile/core/network/dio_client.dart';
import 'package:cms_mobile/core/network/envelope_interceptor.dart';
import 'package:cms_mobile/core/network/retry_interceptor.dart';

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this._handler);

  final Future<ResponseBody> Function(RequestOptions options) _handler;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) => _handler(options);

  @override
  void close({bool force = false}) {}
}

const Map<String, List<String>> _jsonHeaders = <String, List<String>>{
  'content-type': <String>['application/json; charset=utf-8'],
};

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

void main() {
  group('buildDio', () {
    test('baseUrl 取自 AppConfig,超时为起步常量', () {
      final Dio dio = buildDio(_testConfig());

      expect(dio.options.baseUrl, 'http://test.local');
      expect(dio.options.connectTimeout, const Duration(seconds: 10));
      expect(dio.options.receiveTimeout, const Duration(seconds: 10));
      expect(kConnectTimeout, const Duration(seconds: 10));
      expect(kReceiveTimeout, const Duration(seconds: 10));
    });

    test('默认装配重试与信封拦截器,顺序 retry → envelope', () {
      final Dio dio = buildDio(_testConfig());

      expect(dio.interceptors.whereType<RetryInterceptor>(), hasLength(1));
      expect(dio.interceptors.whereType<EnvelopeInterceptor>(), hasLength(1));
      final int retryIndex =
          dio.interceptors.indexWhere((Interceptor i) => i is RetryInterceptor);
      final int envelopeIndex = dio.interceptors
          .indexWhere((Interceptor i) => i is EnvelopeInterceptor);
      expect(retryIndex, lessThan(envelopeIndex));
    });

    test('enableRetry:false 不装配重试拦截器', () {
      final Dio dio = buildDio(_testConfig(), enableRetry: false);

      expect(dio.interceptors.whereType<RetryInterceptor>(), isEmpty);
      expect(dio.interceptors.whereType<EnvelopeInterceptor>(), hasLength(1));
    });

    test('additionalInterceptors 追加在信封之后,看到已解包 data', () async {
      final List<String> seen = <String>[];
      final _FakeAdapter adapter = _FakeAdapter((_) async => ResponseBody.fromString(
            jsonEncode(<String, Object?>{
              'code': 200,
              'message': 'ok',
              'data': <String, Object?>{'via': 'extra'},
            }),
            200,
            headers: _jsonHeaders,
          ));
      final Dio dio = buildDio(
        _testConfig(),
        additionalInterceptors: <Interceptor>[
          InterceptorsWrapper(
            onRequest: (RequestOptions options, RequestInterceptorHandler handler) {
              seen.add('request');
              handler.next(options);
            },
            onResponse: (Response<dynamic> response, ResponseInterceptorHandler handler) {
              seen.add('response');
              handler.next(response);
            },
          ),
        ],
      );
      dio.httpClientAdapter = adapter;

      final Response<dynamic> res =
          await dioCall<dynamic>(() => dio.get<dynamic>('/api/app/ping'));

      expect(seen, <String>['request', 'response']);
      // 追加拦截器在信封之后,拿到的是已解包的 data 载荷。
      expect(res.data, <String, dynamic>{'via': 'extra'});
    });
  });

  group('dioCall', () {
    test('成功路径原样返回 response', () async {
      final RequestOptions options = RequestOptions(path: '/x');
      final Response<dynamic> response = Response<dynamic>(
        data: <String, dynamic>{'ok': 1},
        requestOptions: options,
      );

      final Response<dynamic> res =
          await dioCall<dynamic>(() async => response);

      expect(res.data, <String, dynamic>{'ok': 1});
    });

    test('DioException.error 是 AppError 时原样解出抛出', () async {
      await expectLater(
        dioCall<dynamic>(
          () => Future<Response<dynamic>>.error(
            DioException(
              requestOptions: RequestOptions(path: '/x'),
              error: const AppError(code: 7, message: 'biz'),
            ),
          ),
        ),
        throwsA(
          isA<AppError>()
              .having((AppError e) => e.code, 'code', 7)
              .having((AppError e) => e.message, 'message', 'biz'),
        ),
      );
    });

    test('非 AppError 的 DioException 兜底为网络失败 AppError', () async {
      await expectLater(
        dioCall<dynamic>(
          () => Future<Response<dynamic>>.error(
            DioException(
              requestOptions: RequestOptions(path: '/x'),
              error: 'raw-unknown',
            ),
          ),
        ),
        throwsA(
          isA<AppError>()
              .having((AppError e) => e.code, 'code', 0)
              .having((AppError e) => e.message, 'message', kNetworkErrorMessage),
        ),
      );
    });
  });
}
