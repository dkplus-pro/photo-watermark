import 'package:flutter/material.dart';

import 'permission_service.dart';

/// 每类权限的中文文案(决策 10/12,只出中文;即对外契约,改文案需评审)。
class PermissionCopy {
  const PermissionCopy({
    required this.name,
    required this.rationale,
    required this.settingsHint,
  });

  /// 权限名(如「相机」)。
  final String name;

  /// 首次说明:为什么需要(首次拒绝后再次请求前展示)。
  final String rationale;

  /// 永久拒绝引导:去设置开启。
  final String settingsHint;
}

/// 七类权限文案表(全量,key 与 AppPermission 一一对应,缺 key 是装配错误)。
const Map<AppPermission, PermissionCopy> kPermissionCopyTable = {
  AppPermission.camera: PermissionCopy(
    name: '相机',
    rationale: '需要使用相机拍摄照片,用于扫码、拍照上传等功能。',
    settingsHint: '相机权限已被关闭,请在系统设置中开启后再试。',
  ),
  AppPermission.photo: PermissionCopy(
    name: '相册',
    rationale: '需要访问相册选择或保存图片。',
    settingsHint: '相册权限已被关闭,请在系统设置中开启后再试。',
  ),
  AppPermission.location: PermissionCopy(
    name: '位置',
    rationale: '需要获取当前位置,用于附近内容与本地化服务。',
    settingsHint: '位置权限已被关闭,请在系统设置中开启后再试。',
  ),
  AppPermission.notification: PermissionCopy(
    name: '通知',
    rationale: '需要通知权限,用于接收重要消息提醒。',
    settingsHint: '通知权限已被关闭,请在系统设置中开启后再试。',
  ),
  AppPermission.microphone: PermissionCopy(
    name: '麦克风',
    rationale: '需要使用麦克风录制音频。',
    settingsHint: '麦克风权限已被关闭,请在系统设置中开启后再试。',
  ),
  AppPermission.bluetooth: PermissionCopy(
    name: '蓝牙',
    rationale: '需要使用蓝牙连接附近设备。',
    settingsHint: '蓝牙权限已被关闭,请在系统设置中开启后再试。',
  ),
  AppPermission.contacts: PermissionCopy(
    name: '通讯录',
    rationale: '需要访问通讯录,用于好友邀请等功能。',
    settingsHint: '通讯录权限已被关闭,请在系统设置中开启后再试。',
  ),
};

/// 说明/引导弹窗:permanentlyDenied=false 展示 rationale(「取消/知道了」),
/// permanentlyDenied=true 展示 settingsHint(「取消/去设置」)。
/// 返回 true = 用户点了「去设置」;false/null = 取消或知道了。
Future<bool?> showPermissionRationaleDialog(
  BuildContext context, {
  required AppPermission permission,
  required bool permanentlyDenied,
}) {
  final PermissionCopy copy = kPermissionCopyTable[permission]!;
  return showDialog<bool>(
    context: context,
    builder: (BuildContext dialogContext) => AlertDialog(
      title: Text(copy.name),
      content: Text(permanentlyDenied ? copy.settingsHint : copy.rationale),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('取消'),
        ),
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(permanentlyDenied),
          child: Text(permanentlyDenied ? '去设置' : '知道了'),
        ),
      ],
    ),
  );
}
