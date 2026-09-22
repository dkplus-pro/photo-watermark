import 'dart:io';

import 'package:cms_mobile/core/config/app_config.dart';

import '../jsb_registry.dart';

/// 本文件提供的 method 名(装配与重复检查用)。
const List<String> deviceJSBMethodNames = <String>[
  'getDeviceInfo',
  'getNetworkType',
  'getAppVersion',
];

/// device 组依赖:全部闭包注入,纯 Dart 可测。
class JSBDeviceDependencies {
  const JSBDeviceDependencies({
    required this.config,
    required this.readNetworkType,
    this.readPlatform = _defaultPlatform,
    this.readOsVersion = _defaultOsVersion,
    this.readLocale = _defaultLocale,
  });

  /// 应用配置(getAppVersion 数据源)。
  final AppConfig config;

  /// 读取当前网络类型,返回 'online' | 'offline' | 'unknown'
  /// (接线见 features/webview/webview_page.dart:读 networkStatusServiceProvider.current.name;
  ///  阶段 4 NetworkStatusService 契约见 hybrid-phase-4-5-spec.md §4.3.2)。
  final String Function() readNetworkType;

  /// 以下三个读取器默认走 dart:io Platform;单测注入 fake。
  final String Function() readPlatform;
  final String Function() readOsVersion;
  final String Function() readLocale;
}

String _defaultPlatform() => Platform.operatingSystem;

String _defaultOsVersion() => Platform.operatingSystemVersion;

String _defaultLocale() => Platform.localeName;

/// device 组三 handler:纯读、参数一律忽略(允许空 params)。
/// 读取器自身抛异常时不捕获(由 registry 兜底为 NATIVE_ERROR)。
Map<String, JSBHandler> buildDeviceHandlers(JSBDeviceDependencies deps) {
  return <String, JSBHandler>{
    'getDeviceInfo': (params) async => <String, dynamic>{
          'platform': deps.readPlatform(),
          'osVersion': deps.readOsVersion(),
          'locale': deps.readLocale(),
        },
    'getNetworkType': (params) async => <String, dynamic>{
          'networkType': deps.readNetworkType(),
        },
    'getAppVersion': (params) async => <String, dynamic>{
          'version': deps.config.appVersion,
          'buildNumber': deps.config.buildNumber,
          'flavor': deps.config.flavor.name,
        },
  };
}
