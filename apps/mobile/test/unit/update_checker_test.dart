// UpdateChecker 单测(卡 7.4 UC1–UC8):fake repository 闭包,平台经注入控制。
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mobile/core/config/app_config.dart';
import 'package:cms_mobile/core/error/app_error.dart';
import 'package:cms_mobile/core/network/version_repository.dart';
import 'package:cms_mobile/core/update/update_checker.dart';

AppConfig _config({String version = '0.1.0'}) => AppConfig(
      flavor: Flavor.dev,
      apiBaseUrl: 'http://test.local',
      sentryDsn: '',
      sentryTracesSampleRate: 0,
      analyticsEnabled: false,
      appVersion: version,
      buildNumber: '1',
      pushEnabled: false,
    );

VersionCheckData _data({
  bool hasUpdate = false,
  bool forceUpdate = false,
  String latestVersion = '0.1.0',
  String downloadUrl = '',
  String releaseNotes = '',
}) =>
    (
      hasUpdate: hasUpdate,
      forceUpdate: forceUpdate,
      latestVersion: latestVersion,
      downloadUrl: downloadUrl,
      releaseNotes: releaseNotes,
    );

void main() {
  group('resolveUpdateDecision(纯函数)', () {
    test('UC1: hasUpdate=false → none', () {
      final UpdateDecision d = resolveUpdateDecision(
        currentVersion: '0.1.0',
        remote: _data(hasUpdate: false, latestVersion: '1.0.0'),
      );
      expect(d, kNoUpdate);
      expect(d.action, UpdateAction.none);
    });

    test('UC2: hasUpdate=true, forceUpdate=false → optional,字段透传', () {
      final UpdateDecision d = resolveUpdateDecision(
        currentVersion: '0.1.0',
        remote: _data(
          hasUpdate: true,
          latestVersion: '1.2.0',
          downloadUrl: 'https://x.y/app.apk',
          releaseNotes: '修复问题',
        ),
      );
      expect(d.action, UpdateAction.optional);
      expect(d.latestVersion, '1.2.0');
      expect(d.downloadUrl, 'https://x.y/app.apk');
      expect(d.releaseNotes, '修复问题');
    });

    test('UC3: forceUpdate=true → force', () {
      final UpdateDecision d = resolveUpdateDecision(
        currentVersion: '0.1.0',
        remote:
            _data(hasUpdate: true, forceUpdate: true, latestVersion: '2.0.0'),
      );
      expect(d.action, UpdateAction.force);
    });

    test('UC4: latestVersion 为空或与 currentVersion 相同 → none(护栏)', () {
      expect(
        resolveUpdateDecision(
          currentVersion: '0.1.0',
          remote: _data(hasUpdate: true, latestVersion: ''),
        ),
        kNoUpdate,
      );
      expect(
        resolveUpdateDecision(
          currentVersion: '0.1.0',
          remote: _data(hasUpdate: true, latestVersion: '0.1.0'),
        ),
        kNoUpdate,
      );
    });
  });

  group('resolveRequestPlatform(纯函数,UC6)', () {
    test("ios/android/macOS/'' → 'ios'/'android'/null/null", () {
      expect(resolveRequestPlatform('ios'), 'ios');
      expect(resolveRequestPlatform('android'), 'android');
      expect(resolveRequestPlatform('macos'), isNull);
      expect(resolveRequestPlatform(''), isNull);
    });
  });

  group('UpdateChecker.check', () {
    late int repositoryCalls;
    late VersionCheckData Function() stub;
    late List<Object> errors;

    UpdateChecker build({
      String version = '0.1.0',
      String operatingSystem = 'ios',
      void Function(Object error)? onError,
    }) {
      repositoryCalls = 0;
      errors = <Object>[];
      return UpdateChecker(
        repository: VersionRepositoryStub(
          () {
            repositoryCalls++;
            return stub();
          },
        ),
        config: _config(version: version),
        onError: onError ?? errors.add,
        operatingSystem: () => operatingSystem,
      );
    }

    setUp(() {
      stub = () => _data();
    });

    test('UC8: 平台非 ios/android → 不发请求直接 kNoUpdate(调用数 0)', () async {
      stub = () => fail('不应发起请求');
      final UpdateDecision d = await build(operatingSystem: 'macos').check();
      expect(d, kNoUpdate);
      expect(repositoryCalls, 0);
    });

    test('UC5: repository 抛 AppError → kNoUpdate 且 onError 被调 1 次', () async {
      stub = () => throw const AppError(code: 0, message: '网络连接失败');
      final UpdateDecision d = await build().check();
      expect(d, kNoUpdate);
      expect(errors.length, 1);
    });

    test('UC7: config.appVersion 非法仍发出请求,server 降级 hasUpdate=false → none',
        () async {
      stub = () => _data(hasUpdate: false, latestVersion: '0.1.0');
      final UpdateDecision d = await build(version: 'abc').check();
      expect(repositoryCalls, 1);
      expect(d, kNoUpdate);
    });

    test('optional 决策经编排透传(汇总链路)', () async {
      stub = () => _data(
            hasUpdate: true,
            latestVersion: '1.1.0',
            downloadUrl: 'https://x.y/app.apk',
          );
      final UpdateDecision d = await build().check();
      expect(d.action, UpdateAction.optional);
      expect(d.latestVersion, '1.1.0');
    });
  });
}

/// VersionRepository 替身:可注入返回值/异常,并记录调用次数。
class VersionRepositoryStub implements VersionRepository {
  VersionRepositoryStub(this._check);

  final VersionCheckData Function() _check;

  @override
  Future<VersionCheckData> check({
    required String platform,
    required String version,
    CancelToken? cancelToken,
  }) async =>
      _check();
}
