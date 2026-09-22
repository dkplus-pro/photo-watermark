// VersionRepository 单测(卡 7.4 VR1–VR6):fake HttpClientAdapter 打桩,照 ping 仓库范式。
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mobile/core/config/app_config.dart';
import 'package:cms_mobile/core/error/app_error.dart';
import 'package:cms_mobile/core/network/dio_client.dart';
import 'package:cms_mobile/core/network/envelope_interceptor.dart';
import 'package:cms_mobile/core/network/version_repository.dart';

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this._handler);

  final Future<ResponseBody> Function(RequestOptions options) _handler;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) =>
      _handler(options);

  @override
  void close({bool force = false}) {}
}

const Map<String, List<String>> _jsonHeaders = <String, List<String>>{
  'content-type': <String>['application/json; charset=utf-8'],
};

ResponseBody _jsonBody(Object? json, int statusCode) =>
    ResponseBody.fromString(jsonEncode(json), statusCode,
        headers: _jsonHeaders);

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
  group('VersionRepository.check', () {
    test('VR1: 200 正常载荷 → record 五字段,query 带平台与版本', () async {
      final Dio dio = _dioWith((options) async {
        expect(options.path, '/api/app/version/check');
        expect(options.queryParameters['platform'], 'ios');
        expect(options.queryParameters['version'], '0.1.0');
        return _jsonBody(<String, Object?>{
          'code': 200,
          'message': 'ok',
          'data': <String, Object?>{
            'hasUpdate': true,
            'forceUpdate': false,
            'latestVersion': '1.2.0',
            'downloadUrl': 'https://example.com/app.apk',
            'releaseNotes': '修复已知问题',
          },
        }, 200);
      });
      final VersionRepository repository = VersionRepository(dio);

      final VersionCheckData data = await repository.check(
        platform: 'ios',
        version: '0.1.0',
      );
      expect(data.hasUpdate, isTrue);
      expect(data.forceUpdate, isFalse);
      expect(data.latestVersion, '1.2.0');
      expect(data.downloadUrl, 'https://example.com/app.apk');
      expect(data.releaseNotes, '修复已知问题');
    });

    test('VR2: 载荷非 Map/缺 hasUpdate/类型错 → AppError(形态错误)', () async {
      Future<VersionCheckData> run(Object? payload) async {
        final Dio dio = _dioWith(
          (_) async => _jsonBody(<String, Object?>{
            'code': 200,
            'message': 'ok',
            'data': payload,
          }, 200),
        );
        return VersionRepository(dio)
            .check(platform: 'android', version: '0.1.0');
      }

      AppError err;
      try {
        await run('str');
        fail('应当抛出 AppError');
      } on AppError catch (e) {
        err = e;
      }
      expect(err.message, kMalformedEnvelopeMessage);

      await expectLater(
        run(<String, Object?>{'forceUpdate': false}),
        throwsA(isA<AppError>()),
      );
      await expectLater(
        run(<String, Object?>{
          'hasUpdate': 'yes',
          'forceUpdate': false,
          'latestVersion': '1.0.0',
          'downloadUrl': '',
          'releaseNotes': '',
        }),
        throwsA(isA<AppError>()),
      );
    });

    test('VR3: 信封 code!=200 → AppError 透传', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'code': 500,
          'message': 'panic: internal detail',
        }, 500),
      );
      final VersionRepository repository = VersionRepository(dio);

      await expectLater(
        repository.check(platform: 'ios', version: '0.1.0'),
        throwsA(
          isA<AppError>()
              .having((AppError e) => e.code, 'code', 500)
              .having((AppError e) => e.message, 'message', '服务暂时不可用,请稍后重试'),
        ),
      );
    });

    test('VR4: 传输层失败 → AppError(code:0)', () async {
      final Dio dio = _dioWith(
        (_) async => throw const SocketException('network unreachable'),
      );
      final VersionRepository repository = VersionRepository(dio);

      await expectLater(
        repository.check(platform: 'ios', version: '0.1.0'),
        throwsA(
          isA<AppError>().having((AppError e) => e.code, 'code', 0).having(
              (AppError e) => e.message, 'message', kNetworkErrorMessage),
        ),
      );
    });

    test('VR5: CancelToken 已取消 → AppError(code:-1,请求已取消)', () async {
      final Dio dio = _dioWith((options) async {
        // 模拟取消发生在请求返回前:adapter 直接抛 DioException(cancel)。
        throw DioException.requestCancelled(
          requestOptions: options,
          reason: null,
        );
      });
      final VersionRepository repository = VersionRepository(dio);
      final CancelToken cancelToken = CancelToken()..cancel();

      await expectLater(
        repository.check(
          platform: 'ios',
          version: '0.1.0',
          cancelToken: cancelToken,
        ),
        throwsA(
          isA<AppError>()
              .having((AppError e) => e.code, 'code', kCancelledErrorCode)
              .having((AppError e) => e.message, 'message',
                  kRequestCancelledMessage),
        ),
      );
    });

    test('VR6: downloadUrl/releaseNotes 空串合法 → 原样空串', () async {
      final Dio dio = _dioWith(
        (_) async => _jsonBody(<String, Object?>{
          'code': 200,
          'message': 'ok',
          'data': <String, Object?>{
            'hasUpdate': false,
            'forceUpdate': false,
            'latestVersion': '0.1.0',
            'downloadUrl': '',
            'releaseNotes': '',
          },
        }, 200),
      );
      final VersionRepository repository = VersionRepository(dio);

      final VersionCheckData data = await repository.check(
        platform: 'ios',
        version: '0.1.0',
      );
      expect(data.downloadUrl, '');
      expect(data.releaseNotes, '');
    });
  });

  group('parseVersionCheckData(纯函数)', () {
    test('null / 非对象载荷抛形态错误', () {
      expect(() => parseVersionCheckData(null), throwsA(isA<AppError>()));
      expect(() => parseVersionCheckData(<dynamic>['x']),
          throwsA(isA<AppError>()));
    });
  });
}
