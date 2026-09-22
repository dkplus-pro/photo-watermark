// PermissionService 单测(PS 系列,阶段 6 方案 §4.1.4):fake gateway 注入,薄壳透传语义。
import 'package:cms_mobile/core/permission/permission_handler_service.dart';
import 'package:cms_mobile/core/permission/permission_service.dart';
import 'package:flutter_test/flutter_test.dart';

/// fake gateway:固定返回值/抛错 + 调用计数。
class _FakeGateway implements PermissionGateway {
  _FakeGateway({
    this.statusResult = PermissionAppState.denied,
    this.requestResult = PermissionAppState.denied,
  });

  PermissionAppState statusResult;
  PermissionAppState requestResult;
  bool settingsResult = true;
  Object? error;

  int statusCalls = 0;
  int requestCalls = 0;
  int openSettingsCalls = 0;

  @override
  Future<PermissionAppState> status(AppPermission permission) async {
    statusCalls++;
    final Object? thrown = error;
    if (thrown != null) {
      throw thrown;
    }
    return statusResult;
  }

  @override
  Future<PermissionAppState> request(AppPermission permission) async {
    requestCalls++;
    final Object? thrown = error;
    if (thrown != null) {
      throw thrown;
    }
    return requestResult;
  }

  @override
  Future<bool> openSettings() async {
    openSettingsCalls++;
    return settingsResult;
  }
}

void main() {
  test('PS1 fake gateway granted → check/request 透传', () async {
    final gateway = _FakeGateway(
      statusResult: PermissionAppState.granted,
      requestResult: PermissionAppState.granted,
    );
    final service = PermissionHandlerPermissionService(gateway: gateway);

    expect(
        await service.check(AppPermission.camera), PermissionAppState.granted);
    expect(await service.request(AppPermission.camera),
        PermissionAppState.granted);
    expect(gateway.statusCalls, 1);
    expect(gateway.requestCalls, 1);
  });

  test('PS2 fake gateway permanentlyDenied → request 直通返回(编排在上层)', () async {
    final gateway = _FakeGateway(
      statusResult: PermissionAppState.permanentlyDenied,
      requestResult: PermissionAppState.permanentlyDenied,
    );
    final service = PermissionHandlerPermissionService(gateway: gateway);

    expect(await service.request(AppPermission.photo),
        PermissionAppState.permanentlyDenied);
    expect(gateway.requestCalls, 1);
  });

  test('PS3 fake gateway 抛异常 → 原样上抛不吞', () async {
    final error = StateError('channel failed');
    final gateway = _FakeGateway()..error = error;
    final service = PermissionHandlerPermissionService(gateway: gateway);

    await expectLater(
      service.check(AppPermission.photo),
      throwsA(same(error)),
    );
    await expectLater(
      service.request(AppPermission.photo),
      throwsA(same(error)),
    );
  });

  test('PS4 openSettings 透传 bool', () async {
    final trueGateway = _FakeGateway()..settingsResult = true;
    expect(
      await PermissionHandlerPermissionService(gateway: trueGateway)
          .openSettings(),
      isTrue,
    );

    final falseGateway = _FakeGateway()..settingsResult = false;
    expect(
      await PermissionHandlerPermissionService(gateway: falseGateway)
          .openSettings(),
      isFalse,
    );
  });
}
