// device 组 JSB 方法单测(D 系列,方案 §6.2):fake 依赖全闭包注入,纯 Dart 可测。
import 'package:cms_mobile/core/config/app_config.dart';
import 'package:cms_mobile/core/hybrid/jsb_methods/device.dart';
import 'package:flutter_test/flutter_test.dart';

AppConfig _fakeConfig() => const AppConfig(
      flavor: Flavor.dev,
      apiBaseUrl: 'http://test.local',
      sentryDsn: '',
      sentryTracesSampleRate: 0,
      analyticsEnabled: false,
      appVersion: '0.1.0',
      buildNumber: '1',
      pushEnabled: false,
    );

JSBDeviceDependencies _deps({String networkType = 'online'}) =>
    JSBDeviceDependencies(
      config: _fakeConfig(),
      readNetworkType: () => networkType,
      readPlatform: () => 'android',
      readOsVersion: () => '34',
      readLocale: () => 'zh_CN',
    );

void main() {
  test('D4 method 名清单与 buildDeviceHandlers 键集一致', () {
    expect(deviceJSBMethodNames, <String>[
      'getDeviceInfo',
      'getNetworkType',
      'getAppVersion',
    ]);
    expect(
      buildDeviceHandlers(_deps()).keys.toSet(),
      deviceJSBMethodNames.toSet(),
    );
  });

  test('D1 getDeviceInfo:三键值与 fake 一致,空 params 合法', () async {
    final data = await buildDeviceHandlers(
      _deps(),
    )['getDeviceInfo']!(<String, dynamic>{});

    expect(data, <String, dynamic>{
      'platform': 'android',
      'osVersion': '34',
      'locale': 'zh_CN',
    });
  });

  test('D2 getNetworkType:透传 reader 三态', () async {
    for (final state in <String>['online', 'offline', 'unknown']) {
      final data = await buildDeviceHandlers(
        _deps(networkType: state),
      )['getNetworkType']!(const {});

      expect(data, <String, dynamic>{'networkType': state});
    }
  });

  test('D3 getAppVersion:与注入 config 一致', () async {
    final data = await buildDeviceHandlers(
      _deps(),
    )['getAppVersion']!(const {});

    expect(data, <String, dynamic>{
      'version': '0.1.0',
      'buildNumber': '1',
      'flavor': 'dev',
    });
  });

  test('D5 params 忽略:带 junk 键不影响返回', () async {
    final handlers = buildDeviceHandlers(_deps());
    final junk = <String, dynamic>{'junk': 1};

    expect(
      await handlers['getDeviceInfo']!(junk),
      <String, dynamic>{
        'platform': 'android',
        'osVersion': '34',
        'locale': 'zh_CN',
      },
    );
    expect(
      await handlers['getNetworkType']!(junk),
      <String, dynamic>{'networkType': 'online'},
    );
    expect(
      await handlers['getAppVersion']!(junk),
      <String, dynamic>{
        'version': '0.1.0',
        'buildNumber': '1',
        'flavor': 'dev',
      },
    );
  });

  test('D6 读取器抛错 → handler Future 失败(由 registry 兜底)', () async {
    final deps = JSBDeviceDependencies(
      config: _fakeConfig(),
      readNetworkType: () => 'online',
      readPlatform: () => throw StateError('platform read failed'),
    );
    final handler = buildDeviceHandlers(deps)['getDeviceInfo']!;

    await expectLater(handler(const {}), throwsStateError);
  });
}
