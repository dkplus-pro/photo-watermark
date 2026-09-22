// permission 映射单测(P 系列,阶段 6 方案 §4.1.4):七类权限映射 + 六状态映射 + 可用性判定。
// permission_handler 的枚举类型不触平台通道,Dart VM 可直测。
import 'package:cms_mobile/core/permission/permission_handler_service.dart';
import 'package:cms_mobile/core/permission/permission_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:permission_handler/permission_handler.dart' as ph;

void main() {
  test('P1 toPlatformPermission 七类全覆盖(编译期穷举,无 default)', () {
    expect(toPlatformPermission(AppPermission.camera), ph.Permission.camera);
    expect(toPlatformPermission(AppPermission.photo), ph.Permission.photos);
    expect(
      toPlatformPermission(AppPermission.location),
      ph.Permission.locationWhenInUse,
    );
    expect(
      toPlatformPermission(AppPermission.notification),
      ph.Permission.notification,
    );
    expect(
      toPlatformPermission(AppPermission.microphone),
      ph.Permission.microphone,
    );
    expect(
      toPlatformPermission(AppPermission.bluetooth),
      ph.Permission.bluetooth,
    );
    expect(
      toPlatformPermission(AppPermission.contacts),
      ph.Permission.contacts,
    );
  });

  test('P2 mapPermissionHandlerStatus 六状态全覆盖(含 provisional→granted)', () {
    expect(
      mapPermissionHandlerStatus(ph.PermissionStatus.granted),
      PermissionAppState.granted,
    );
    expect(
      mapPermissionHandlerStatus(ph.PermissionStatus.denied),
      PermissionAppState.denied,
    );
    expect(
      mapPermissionHandlerStatus(ph.PermissionStatus.limited),
      PermissionAppState.limited,
    );
    expect(
      mapPermissionHandlerStatus(ph.PermissionStatus.permanentlyDenied),
      PermissionAppState.permanentlyDenied,
    );
    expect(
      mapPermissionHandlerStatus(ph.PermissionStatus.restricted),
      PermissionAppState.restricted,
    );
    expect(
      mapPermissionHandlerStatus(ph.PermissionStatus.provisional),
      PermissionAppState.granted,
    );
  });

  test('P3 isPermissionUsable:granted/limited 可用,其余不可用', () {
    expect(isPermissionUsable(PermissionAppState.granted), isTrue);
    expect(isPermissionUsable(PermissionAppState.limited), isTrue);
    expect(isPermissionUsable(PermissionAppState.denied), isFalse);
    expect(isPermissionUsable(PermissionAppState.permanentlyDenied), isFalse);
    expect(isPermissionUsable(PermissionAppState.restricted), isFalse);
  });
}
