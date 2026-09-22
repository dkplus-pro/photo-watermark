import 'package:permission_handler/permission_handler.dart' as ph;

import 'permission_service.dart';

/// permission_handler 状态 → 五态映射(纯函数,单测直测):
/// granted→granted;denied→denied;limited→limited;permanentlyDenied→permanentlyDenied;
/// restricted→restricted;provisional→granted(iOS 临时通知授权按可用处理)。
PermissionAppState mapPermissionHandlerStatus(ph.PermissionStatus status) =>
    switch (status) {
      ph.PermissionStatus.granted => PermissionAppState.granted,
      ph.PermissionStatus.provisional => PermissionAppState.granted,
      ph.PermissionStatus.denied => PermissionAppState.denied,
      ph.PermissionStatus.limited => PermissionAppState.limited,
      ph.PermissionStatus.permanentlyDenied =>
        PermissionAppState.permanentlyDenied,
      ph.PermissionStatus.restricted => PermissionAppState.restricted,
    };

/// AppPermission → permission_handler.Permission 映射(纯函数,switch 全分支覆盖,
/// 编译期穷举校验,无 default——新增枚举值漏映射即编译失败):
/// camera→Permission.camera;photo→Permission.photos;location→Permission.locationWhenInUse;
/// notification→Permission.notification;microphone→Permission.microphone;
/// bluetooth→Permission.bluetooth;contacts→Permission.contacts。
ph.Permission toPlatformPermission(AppPermission permission) {
  switch (permission) {
    case AppPermission.camera:
      return ph.Permission.camera;
    case AppPermission.photo:
      return ph.Permission.photos;
    case AppPermission.location:
      return ph.Permission.locationWhenInUse;
    case AppPermission.notification:
      return ph.Permission.notification;
    case AppPermission.microphone:
      return ph.Permission.microphone;
    case AppPermission.bluetooth:
      return ph.Permission.bluetooth;
    case AppPermission.contacts:
      return ph.Permission.contacts;
  }
}

/// permission_handler 桥接(插件薄壳,单测不触)。
class PermissionHandlerGateway implements PermissionGateway {
  const PermissionHandlerGateway();

  @override
  Future<PermissionAppState> status(AppPermission permission) async =>
      mapPermissionHandlerStatus(await toPlatformPermission(permission).status);

  @override
  Future<PermissionAppState> request(AppPermission permission) async =>
      mapPermissionHandlerStatus(
        await toPlatformPermission(permission).request(),
      );

  @override
  Future<bool> openSettings() => ph.openAppSettings();
}

/// PermissionService 生产实现:薄壳转发 gateway,无业务逻辑(编排语义在调用方/JSB 层)。
/// 不吞异常:gateway 抛错原样上抛(调用方按降级策略处理),不做重试。
class PermissionHandlerPermissionService implements PermissionService {
  const PermissionHandlerPermissionService({
    PermissionGateway gateway = const PermissionHandlerGateway(),
  }) : _gateway = gateway;

  final PermissionGateway _gateway;

  @override
  Future<PermissionAppState> check(AppPermission permission) =>
      _gateway.status(permission);

  @override
  Future<PermissionAppState> request(AppPermission permission) =>
      _gateway.request(permission);

  @override
  Future<bool> openSettings() => _gateway.openSettings();
}
