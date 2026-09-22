import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mobile/core/config/app_config.dart';
import 'package:cms_mobile/core/error/app_error.dart';
import 'package:cms_mobile/core/network/dio_client.dart';
import 'package:cms_mobile/core/network/envelope_interceptor.dart';

/// 可编程的假适配器:不引额外依赖,直接替换 dio.httpClientAdapter。
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

const Object _unset = Object();

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

Matcher _appError({Object? code = _unset, Object? message = _unset, Object? logID = _unset}) {
  TypeMatcher<AppError> matcher = isA<AppError>();
  if (!identical(code, _unset)) {
    matcher = matcher.having((AppError e) => e.code, 'code', code);
  }
  if (!identical(message, _unset)) {
    matcher = matcher.having((AppError e) => e.message, 'message', message);
  }
  if (!identical(logID, _unset)) {
    matcher = matcher.having((AppError e) => e.logID, 'logID', logID);
  }
  return matcher;
}

/// 走真实调用边界(dioCall),拿业务层最终拿到的 AppError。
Future<AppError> _caughtAppError(Dio dio) async {
  try {
    await dioCall<dynamic>(() => dio.get<dynamic>('/api/app/ping'));
  } on AppError catch (e) {
    return e;
  }
  fail('应当抛出 AppError');
}

void main() {
  group('EnvelopeInterceptor:HTTP 200 信封', () {
    test('code==200 解包 data 载荷返回', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'code': 200,
          'message': 'ok',
          'data': <String, Object?>{'message': 'pong'},
          'logID': 'log-1',
        }, 200),
      );

      final Response<dynamic> res =
          await dioCall<dynamic>(() => dio.get<dynamic>('/api/app/ping'));

      expect(res.data, <String, dynamic>{'message': 'pong'});
    });

    test('空响应体抛形态错误 AppError', () async {
      final Dio dio = _dioWith(
        (_) async => ResponseBody.fromString('', 200, headers: _jsonHeaders),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 0, message: kMalformedEnvelopeMessage, logID: null),
      );
    });

    test('信封为 JSON null 抛形态错误 AppError', () async {
      final Dio dio = _dioWith((_) async => _jsonBody(null, 200));

      expect(
        await _caughtAppError(dio),
        _appError(code: 0, message: kMalformedEnvelopeMessage),
      );
    });

    test('信封为非对象(数组)抛形态错误 AppError', () async {
      final Dio dio = _dioWith((_) async => _jsonBody(<Object?>[1, 2], 200));

      expect(
        await _caughtAppError(dio),
        _appError(code: 0, message: kMalformedEnvelopeMessage),
      );
    });

    test('非 JSON content-type 的响应体抛形态错误 AppError', () async {
      final Dio dio = _dioWith(
        (_) async => ResponseBody.fromString('plain-text', 200),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 0, message: kMalformedEnvelopeMessage),
      );
    });

    test('缺 code 字段按 0 抛业务 AppError', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'message': 'ok',
          'data': <String, Object?>{'message': 'pong'},
        }, 200),
      );

      expect(await _caughtAppError(dio), _appError(code: 0, message: 'ok'));
    });

    test('缺 message 字段兜底通用文案', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{'code': 500}, 200),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 500, message: kGenericRequestFailedMessage, logID: null),
      );
    });

    test('非 200 code 抛业务 AppError,透传 message 与 logID', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'code': 409,
          'message': 'conflict',
          'logID': 'log-9',
        }, 200),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 409, message: 'conflict', logID: 'log-9'),
      );
    });

    test('非法 JSON 抛形态错误 AppError', () async {
      final Dio dio = _dioWith(
        (_) async =>
            ResponseBody.fromString('not-json', 200, headers: _jsonHeaders),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 0, message: kMalformedEnvelopeMessage),
      );
    });

    test('code 为字符串数字按数值处理,正常解包', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'code': '200',
          'message': 'ok',
          'data': <String, Object?>{'message': 'pong'},
        }, 200),
      );

      final Response<dynamic> res =
          await dioCall<dynamic>(() => dio.get<dynamic>('/api/app/ping'));

      expect(res.data, <String, dynamic>{'message': 'pong'});
    });

    test('code 为非数字字符串按 0 抛业务 AppError', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'code': 'oops',
          'message': 'bad envelope',
        }, 200),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 0, message: 'bad envelope'),
      );
    });

    test('code 为 null 抛业务 AppError', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'code': null,
          'message': 'no code',
        }, 200),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 0, message: 'no code'),
      );
    });
  });

  group('EnvelopeInterceptor:HTTP 非 2xx 映射', () {
    test('404 映射通用文案并提取 logID,不透传服务端内部 message', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'code': 404,
          'message': 'internal route detail /api/app/ping not found',
          'logID': 'log-7',
        }, 404),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 404, message: '请求的资源不存在', logID: 'log-7'),
      );
    });

    test('401 映射登录失效文案(权限缺失边界)', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{'code': 401}, 401),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 401, message: '登录状态已失效,请重新登录'),
      );
    });

    test('403 映射没有操作权限文案', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{'code': 403}, 403),
      );

      expect(await _caughtAppError(dio), _appError(code: 403, message: '没有操作权限'));
    });

    test('500 映射服务暂不可用文案', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{'code': 500}, 500),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 500, message: '服务暂时不可用,请稍后重试'),
      );
    });

    test('非 JSON 错误体也能映射,logID 缺省为 null', () async {
      final Dio dio = _dioWith(
        (_) async => ResponseBody.fromString('gateway error', 502),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 502, message: '服务暂时不可用,请稍后重试', logID: null),
      );
    });
  });

  group('EnvelopeInterceptor:传输层失败映射', () {
    test('SocketException 抛 AppError(0, 网络连接失败, null)', () async {
      final Dio dio = _dioWith(
        (_) async => throw const SocketException('connection refused'),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 0, message: kNetworkErrorMessage, logID: null),
      );
    });

    test('连接超时抛 AppError(0, 网络连接失败)', () async {
      final Dio dio = _dioWith(
        (options) async => throw DioException.connectionTimeout(
          timeout: const Duration(milliseconds: 10),
          requestOptions: options,
        ),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 0, message: kNetworkErrorMessage),
      );
    });

    test('接收超时抛 AppError(0, 网络连接失败)', () async {
      final Dio dio = _dioWith(
        (options) async => throw DioException.receiveTimeout(
          timeout: const Duration(milliseconds: 10),
          requestOptions: options,
        ),
      );

      expect(
        await _caughtAppError(dio),
        _appError(code: 0, message: kNetworkErrorMessage),
      );
    });
  });
}
