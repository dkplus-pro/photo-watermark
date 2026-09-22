import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mobile/core/config/app_config.dart';
import 'package:cms_mobile/core/error/app_error.dart';
import 'package:cms_mobile/core/network/dio_client.dart';
import 'package:cms_mobile/core/network/envelope_interceptor.dart';
import 'package:cms_mobile/core/network/ping_repository.dart';

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

ResponseBody _jsonBody(Object? json, int statusCode) =>
    ResponseBody.fromString(jsonEncode(json), statusCode, headers: _jsonHeaders);

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

Dio _dioWith(Future<ResponseBody> Function(RequestOptions) handler) {
  final Dio dio = buildDio(_testConfig(), enableRetry: false);
  dio.httpClientAdapter = _FakeAdapter(handler);
  return dio;
}

void main() {
  group('PingRepository.fetchMessage', () {
    test('走 dio + 信封拦截器返回 data.message', () async {
      final Dio dio = _dioWith(
        (options) async {
          expect(options.method, 'GET');
          expect(options.path, '/api/app/ping');
          return _jsonBody(<String, Object?>{
            'code': 200,
            'message': 'ok',
            'data': <String, Object?>{'message': 'pong from app api'},
            'logID': 'log-1',
          }, 200);
        },
      );
      final PingRepository repository = PingRepository(dio);

      expect(await repository.fetchMessage(), 'pong from app api');
    });

    test('message 为空串视为合法,原样返回', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'code': 200,
          'message': 'ok',
          'data': <String, Object?>{'message': ''},
        }, 200),
      );
      final PingRepository repository = PingRepository(dio);

      expect(await repository.fetchMessage(), '');
    });

    test('data 缺 message 抛形态错误 AppError', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'code': 200,
          'message': 'ok',
          'data': <String, Object?>{},
        }, 200),
      );
      final PingRepository repository = PingRepository(dio);

      await expectLater(
        repository.fetchMessage(),
        throwsA(
          isA<AppError>().having(
            (AppError e) => e.message,
            'message',
            kMalformedEnvelopeMessage,
          ),
        ),
      );
    });

    test('data.message 非字符串抛形态错误 AppError', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'code': 200,
          'message': 'ok',
          'data': <String, Object?>{'message': 1},
        }, 200),
      );
      final PingRepository repository = PingRepository(dio);

      await expectLater(
        repository.fetchMessage(),
        throwsA(isA<AppError>()),
      );
    });

    test('code==200 但 data 为 null 抛形态错误 AppError', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'code': 200,
          'message': 'ok',
          'data': null,
        }, 200),
      );
      final PingRepository repository = PingRepository(dio);

      await expectLater(
        repository.fetchMessage(),
        throwsA(
          isA<AppError>().having((AppError e) => e.code, 'code', 0),
        ),
      );
    });

    test('HTTP 500 映射为通用文案 AppError', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'code': 500,
          'message': 'panic: internal detail',
        }, 500),
      );
      final PingRepository repository = PingRepository(dio);

      AppError err;
      try {
        await repository.fetchMessage();
        fail('应当抛出 AppError');
      } on AppError catch (e) {
        err = e;
      }

      expect(err.code, 500);
      expect(err.message, '服务暂时不可用,请稍后重试');
    });

    test('断网抛网络失败 AppError', () async {
      final Dio dio = _dioWith(
        (_) async => throw const SocketException('network unreachable'),
      );
      final PingRepository repository = PingRepository(dio);

      await expectLater(
        repository.fetchMessage(),
        throwsA(
          isA<AppError>()
              .having((AppError e) => e.code, 'code', 0)
              .having(
                (AppError e) => e.message,
                'message',
                kNetworkErrorMessage,
              ),
        ),
      );
    });
  });

  group('extractPingMessage(纯函数)', () {
    test('Map 载荷取 message', () {
      expect(
        extractPingMessage(<String, dynamic>{'message': 'hello'}),
        'hello',
      );
    });

    test('null / 非对象载荷抛形态错误', () {
      expect(() => extractPingMessage(null), throwsA(isA<AppError>()));
      expect(() => extractPingMessage(<dynamic>['x']), throwsA(isA<AppError>()));
      expect(() => extractPingMessage('str'), throwsA(isA<AppError>()));
    });

    test('message 缺失或非字符串抛形态错误', () {
      expect(() => extractPingMessage(<String, dynamic>{}),
          throwsA(isA<AppError>()));
      expect(() => extractPingMessage(<String, dynamic>{'message': true}),
          throwsA(isA<AppError>()));
    });
  });
}
