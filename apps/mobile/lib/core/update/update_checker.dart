import 'dart:io';

import 'package:dio/dio.dart';

import 'package:cms_mobile/core/config/app_config.dart';
import 'package:cms_mobile/core/network/version_repository.dart';

/// 更新决策三态:none=不打扰;optional=可关闭弹窗;force=强制(不可关闭,决策 8)。
enum UpdateAction { none, optional, force }

/// 更新决策结果。
typedef UpdateDecision = ({
  UpdateAction action,
  String latestVersion,
  String downloadUrl,
  String releaseNotes,
});

const UpdateDecision kNoUpdate = (
  action: UpdateAction.none,
  latestVersion: '',
  downloadUrl: '',
  releaseNotes: '',
);

/// 决策合并(纯函数):信任 server 的 hasUpdate/forceUpdate(server 已做版本比较,卡 7.1);
/// 护栏:remote.latestVersion 为空或与 currentVersion 相同 → none(容错坏配置);
/// hasUpdate=false → none;forceUpdate=true → force;其余 optional。
UpdateDecision resolveUpdateDecision({
  required String currentVersion,
  required VersionCheckData remote,
}) {
  if (!remote.hasUpdate) {
    return kNoUpdate;
  }
  final String latest = remote.latestVersion.trim();
  if (latest.isEmpty || latest == currentVersion) {
    return kNoUpdate;
  }
  return (
    action: remote.forceUpdate ? UpdateAction.force : UpdateAction.optional,
    latestVersion: remote.latestVersion,
    downloadUrl: remote.downloadUrl,
    releaseNotes: remote.releaseNotes,
  );
}

/// 请求平台归一(纯函数):Platform.operatingSystem → 'ios'/'android';
/// 其他(fuchsia/macos 开发机) → null(跳过检查)。
String? resolveRequestPlatform(String operatingSystem) {
  switch (operatingSystem) {
    case 'ios':
      return 'ios';
    case 'android':
      return 'android';
    default:
      return null;
  }
}

/// 更新检查编排:网络失败/非法一律降级 kNoUpdate(降级不阻断主流程,决策 8/10 同款哲学);
/// 失败经 onError 闭包上报(装配层接 AppLogger,本文件不 import logging,不新增跨模块例外)。
class UpdateChecker {
  UpdateChecker({
    required VersionRepository repository,
    required AppConfig config,
    void Function(Object error)? onError,
    String Function()? operatingSystem,
  })  : _repository = repository,
        _config = config,
        _onError = onError,
        _operatingSystem = operatingSystem ?? (() => Platform.operatingSystem);

  final VersionRepository _repository;
  final AppConfig _config;
  final void Function(Object error)? _onError;
  final String Function() _operatingSystem;

  /// 执行一次检查;平台不支持/失败 → kNoUpdate。
  Future<UpdateDecision> check({CancelToken? cancelToken}) async {
    final String? platform = resolveRequestPlatform(_operatingSystem());
    if (platform == null) {
      return kNoUpdate;
    }
    try {
      final VersionCheckData remote = await _repository.check(
        platform: platform,
        version: _config.appVersion,
        cancelToken: cancelToken,
      );
      return resolveUpdateDecision(
          currentVersion: _config.appVersion, remote: remote);
    } on Object catch (error) {
      _onError?.call(error);
      return kNoUpdate;
    }
  }
}
