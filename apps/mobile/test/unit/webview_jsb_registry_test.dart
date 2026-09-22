// webview JSB 装配单测(A 系列,方案 §6.6):四组 handler 全量注册、无重复、可分发。
import 'package:cms_mobile/core/config/app_config.dart';
import 'package:cms_mobile/core/hybrid/jsb_methods/device.dart';
import 'package:cms_mobile/core/hybrid/jsb_methods/media.dart';
import 'package:cms_mobile/core/hybrid/jsb_methods/page.dart';
import 'package:cms_mobile/core/hybrid/jsb_methods/ui.dart';
import 'package:cms_mobile/core/hybrid/jsb_registry.dart';
import 'package:cms_mobile/core/permission/permission_service.dart';
import 'package:cms_mobile/features/webview/webview_jsb_registry.dart';
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

/// media 组 fake 依赖:闭包全 no-op(装配断言只关心注册表形状)。
JSBMediaDependencies _fakeMediaDeps() => JSBMediaDependencies(
      ensurePermission: (permission) async => PermissionAppState.granted,
      showPermissionDeniedHint: (permission, {required permanentlyDenied}) {},
      pickFromGallery: ({required maxDim, required quality}) async => null,
      pickFromCamera: ({required maxDim, required quality}) async => null,
      saveToAlbum: (path) async {},
      readImageInfo: (path) async => (
        path: path,
        width: 1,
        height: 1,
        sizeBytes: 1,
      ),
      readFileBytes: (path) async => const <int>[],
    );

JSBRegistry _build() {
  return buildWebViewJSBRegistry(
    device: JSBDeviceDependencies(
      config: _fakeConfig(),
      readNetworkType: () => 'online',
      readPlatform: () => 'android',
      readOsVersion: () => '34',
      readLocale: () => 'zh_CN',
    ),
    ui: JSBUIDependencies(
      showToast: (_, {required long}) {},
      showLoading: (_) {},
      hideLoading: () {},
      setNavigationBarTitle: (_) {},
    ),
    page: JSBPageDependencies(
      navigate: (_) {},
      canPop: () => false,
      pop: () {},
    ),
    media: _fakeMediaDeps(),
  );
}

void main() {
  test('A1 装配完整性:methodCount == 13,四组清单逐一 hasMethod', () {
    final registry = _build();
    final allNames = <String>[
      ...deviceJSBMethodNames,
      ...uiJSBMethodNames,
      ...pageJSBMethodNames,
      ...mediaJSBMethodNames,
    ];

    expect(registry.methodCount, 13);
    for (final name in allNames) {
      expect(registry.hasMethod(name), isTrue, reason: 'missing method: $name');
    }
  });

  test('A2 无重复注册:四组清单拼接后 toSet().length == 13', () {
    final allNames = <String>[
      ...deviceJSBMethodNames,
      ...uiJSBMethodNames,
      ...pageJSBMethodNames,
      ...mediaJSBMethodNames,
    ];

    expect(allNames.toSet().length, 13);
    // 装配本身不抛 ArgumentError(重复会在 registerAll 同步抛出)。
    expect(_build, returnsNormally);
  });

  test('A3 装配后可分发:getAppVersion 成功;showToast 缺 message → BAD_PARAMS 信封',
      () async {
    final registry = _build();

    final ok = await registry.dispatch('getAppVersion', const {});
    expect(ok['code'], 0);
    expect(ok['data'], <String, dynamic>{
      'version': '0.1.0',
      'buildNumber': '1',
      'flavor': 'dev',
    });

    final bad = await registry.dispatch('showToast', const {});
    expect(bad['code'], 1002);
    final error = bad['error'] as Map<String, dynamic>;
    expect(error['code'], 'BAD_PARAMS');
  });

  test('A4 事件常量:kWebViewReadyEvent == native.webview.ready', () {
    expect(kWebViewReadyEvent, 'native.webview.ready');
  });
}
