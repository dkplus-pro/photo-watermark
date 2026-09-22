import 'dart:convert';

import 'package:cms_mobile/core/permission/permission_service.dart';

import '../jsb_registry.dart';

/// 本文件提供的 method 名(装配与重复检查用)。
const List<String> mediaJSBMethodNames = <String>[
  'chooseImage',
  'takePhoto',
  'saveImageToAlbum',
  'getImageInfo',
];

/// 权限拒绝错误码:不在 registry 数字码表内 → 数字码兜底 1000(NATIVE_ERROR),
/// 本字符串码在 error.code 原样透传;js 侧归一 NATIVE_ERROR + nativeCode(protocol.ts 既定语义)。
const String kJSBErrPermissionDenied = 'PERMISSION_DENIED';

/// dataUrl 内联上限:压缩后 sizeBytes 超过 1MB 不再内联(信封体积护栏,超限静默省略该键)。
const int kMaxInlineDataUrlBytes = 1024 * 1024;

/// 选图/拍图参数边界(与 core/media 默认值对齐)。
const int kJSBDefaultMaxDim = 2048;
const int kJSBMaxPickDim = 4096;
const int kJSBDefaultQuality = 80;

/// 七类权限的中文名(与 permission_rationale.dart kPermissionCopyTable.name 逐字一致;
/// 刻意不 import permission_rationale(其依赖 flutter/material),改文案需两处同步)。
const Map<AppPermission, String> _kPermissionNames = {
  AppPermission.camera: '相机',
  AppPermission.photo: '相册',
  AppPermission.location: '位置',
  AppPermission.notification: '通知',
  AppPermission.microphone: '麦克风',
  AppPermission.bluetooth: '蓝牙',
  AppPermission.contacts: '通讯录',
};

/// 图片 content type 推断(与 core/media/image_info_service.dart resolveImageType
/// 同表;刻意不 import core/media 以守 hybrid 零耦合,改映射需两处同步)。
String _imageContentType(String path) {
  final int slash = path.lastIndexOf('/');
  final String name = slash < 0 ? path : path.substring(slash + 1);
  final int dot = name.lastIndexOf('.');
  final String extension = dot < 0 || dot == name.length - 1
      ? ''
      : name.substring(dot + 1).toLowerCase();
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'jpeg';
    case 'png':
      return 'png';
    case 'gif':
      return 'gif';
    case 'webp':
      return 'webp';
    case 'heic':
      return 'heic';
    default:
      return 'unknown';
  }
}

/// 单张图片的 JSB 侧投影(与 core/media PickedImage 同构,避免 hybrid → media 的类型耦合面扩大;
/// 装配层一行记录转换)。
typedef JSBPickedImage = ({
  String path,
  int? width,
  int? height,
  int sizeBytes
});

/// media 组依赖:全部闭包注入,纯 Dart 可测;实现由 webview 容器页装配。
class JSBMediaDependencies {
  const JSBMediaDependencies({
    required this.ensurePermission,
    required this.showPermissionDeniedHint,
    required this.pickFromGallery,
    required this.pickFromCamera,
    required this.saveToAlbum,
    required this.readImageInfo,
    required this.readFileBytes,
  });

  /// check→(denied 时)request 后的最终权限状态(编排闭包,实现方一次完成)。
  final Future<PermissionAppState> Function(AppPermission permission)
      ensurePermission;

  /// 拒绝提示:容器页弹 PermissionRationaleDialog(permanentlyDenied 决定文案与按钮)。
  final void Function(AppPermission permission,
      {required bool permanentlyDenied}) showPermissionDeniedHint;

  /// 选图/拍照(已含压缩管线);用户取消返回 null。
  final Future<JSBPickedImage?> Function(
      {required int maxDim, required int quality}) pickFromGallery;
  final Future<JSBPickedImage?> Function(
      {required int maxDim, required int quality}) pickFromCamera;

  /// 保存到相册;失败抛异常。
  final Future<void> Function(String path) saveToAlbum;

  /// 读取图片信息;文件不存在/解码失败抛异常。
  final Future<JSBPickedImage> Function(String path) readImageInfo;

  /// 读文件字节(dataUrl 内联用);失败抛异常。
  final Future<List<int>> Function(String path) readFileBytes;
}

/// 可选 int 参数解析(私有纯函数):缺省用 defaultValue;数字只接受 int;
/// 越界(不在 [min, max])或类型错一律抛 BAD_PARAMS(JSB 参数边界不做 clamp)。
int _intInRange(
  Map<String, dynamic> params,
  String method,
  String key,
  int defaultValue,
  int min,
  int max,
) {
  final Object? raw = params[key];
  if (raw == null) {
    return defaultValue;
  }
  if (raw is! int || raw < min || raw > max) {
    throw JSBException(kJSBErrBadParams,
        '$method: "$key" must be an int between $min and $max');
  }
  return raw;
}

/// 选图/拍图参数解析(私有):maxDim int(1..4096,缺省 2048)、quality int(1..100,缺省 80)、
/// withBase64 bool(缺省 false);类型错/越界抛 BAD_PARAMS。
({int maxDim, int quality, bool withBase64}) _parsePickParams(
  Map<String, dynamic> params,
  String method,
) {
  final Object? rawWithBase64 = params['withBase64'];
  if (rawWithBase64 != null && rawWithBase64 is! bool) {
    throw JSBException(
        kJSBErrBadParams, '$method: "withBase64" must be a boolean');
  }
  return (
    maxDim: _intInRange(
        params, method, 'maxDim', kJSBDefaultMaxDim, 1, kJSBMaxPickDim),
    quality: _intInRange(params, method, 'quality', kJSBDefaultQuality, 1, 100),
    withBase64: rawWithBase64 is bool ? rawWithBase64 : false,
  );
}

/// 必填 tempPath 校验(私有):非空字符串;缺失/空串/非字符串 → BAD_PARAMS。
String _requireTempPath(Map<String, dynamic> params, String method) {
  final Object? raw = params['tempPath'];
  if (raw is! String || raw.trim().isEmpty) {
    throw JSBException(
        kJSBErrBadParams, '$method: "tempPath" must be a non-empty string');
  }
  return raw;
}

/// 权限编排(私有):isPermissionUsable → 继续;permanentlyDenied/restricted →
/// 永久拒绝提示 + settingsHint 文案;其余(仍 denied)→ 首次说明提示 + 未获得权限文案。
Future<void> _ensureUsable(
  JSBMediaDependencies deps,
  AppPermission permission,
) async {
  final PermissionAppState state = await deps.ensurePermission(permission);
  if (isPermissionUsable(state)) {
    return;
  }
  if (state == PermissionAppState.permanentlyDenied ||
      state == PermissionAppState.restricted) {
    deps.showPermissionDeniedHint(permission, permanentlyDenied: true);
    throw JSBException(kJSBErrPermissionDenied,
        '${_kPermissionNames[permission]}权限已被关闭,请在系统设置中开启后再试。');
  }
  deps.showPermissionDeniedHint(permission, permanentlyDenied: false);
  throw JSBException(kJSBErrPermissionDenied,
      '未获得${_kPermissionNames[permission]}权限,已取消本次操作。');
}

/// 拼选图返回 Map(私有):tempPath/sizeBytes 固定;width/height 为 null 时键省略
/// (H5 侧可选链读取);withBase64 且 sizeBytes ≤ 1MB 时 readFileBytes+base64Encode
/// 内联 dataUrl(形态 `data:image/<type>;base64,<...>`),超限静默省略该键。
Future<Map<String, dynamic>> _pickedResult(
  JSBMediaDependencies deps,
  JSBPickedImage picked, {
  required bool withBase64,
}) async {
  final Map<String, dynamic> data = <String, dynamic>{
    'tempPath': picked.path,
    'sizeBytes': picked.sizeBytes,
  };
  if (picked.width != null) {
    data['width'] = picked.width;
  }
  if (picked.height != null) {
    data['height'] = picked.height;
  }
  if (withBase64 && picked.sizeBytes <= kMaxInlineDataUrlBytes) {
    final List<int> bytes = await deps.readFileBytes(picked.path);
    data['dataUrl'] =
        'data:image/${_imageContentType(picked.path)};base64,${base64Encode(bytes)}';
  }
  return data;
}

/// media 组四 handler:chooseImage/takePhoto/saveImageToAlbum 权限前置;
/// 取消 → CANCELLED('用户已取消');权限拒绝 → PERMISSION_DENIED(中文文案);
/// 参数非法 → BAD_PARAMS;读取/保存失败让异常穿透,由 registry 兜底 NATIVE_ERROR。
Map<String, JSBHandler> buildMediaHandlers(JSBMediaDependencies deps) {
  Future<Map<String, dynamic>?> handlePick(
    AppPermission permission,
    Future<JSBPickedImage?> Function(
            {required int maxDim, required int quality})
        pick,
    Map<String, dynamic> params,
    String method,
  ) async {
    await _ensureUsable(deps, permission);
    final ({int maxDim, int quality, bool withBase64}) parsed =
        _parsePickParams(params, method);
    final JSBPickedImage? picked =
        await pick(maxDim: parsed.maxDim, quality: parsed.quality);
    if (picked == null) {
      throw const JSBException(kJSBErrCancelled, '用户已取消');
    }
    return _pickedResult(deps, picked, withBase64: parsed.withBase64);
  }

  return <String, JSBHandler>{
    'chooseImage': (params) => handlePick(
          AppPermission.photo,
          deps.pickFromGallery,
          params,
          'chooseImage',
        ),
    'takePhoto': (params) => handlePick(
          AppPermission.camera,
          deps.pickFromCamera,
          params,
          'takePhoto',
        ),
    'getImageInfo': (params) async {
      final String path = _requireTempPath(params, 'getImageInfo');
      final JSBPickedImage info = await deps.readImageInfo(path);
      // width/height 由 readImageInfo 保证非 null;null 属非法状态,直接穿透
      // (registry 兜底 NATIVE_ERROR),本 handler 不做二次包装。
      return <String, dynamic>{
        'width': info.width!,
        'height': info.height!,
        'type': _imageContentType(info.path),
        'sizeBytes': info.sizeBytes,
      };
    },
    'saveImageToAlbum': (params) async {
      final String path = _requireTempPath(params, 'saveImageToAlbum');
      await _ensureUsable(deps, AppPermission.photo);
      await deps.saveToAlbum(path);
      return null;
    },
  };
}
