// 统一权限抽象(决策 10):懒请求 + 状态机;业务调用前 check,拒绝降级不阻断主流程。
// 本文件零第三方依赖;permission_handler 桥接在 permission_handler_service.dart。

/// 七类权限(决策 10,枚举值即对外契约,顺序固定)。
enum AppPermission {
  camera,
  photo,
  location,
  notification,
  microphone,
  bluetooth,
  contacts
}

/// 权限五态状态机。
/// granted=已授权;denied=未授权(可再请求);limited=iOS 限定授权(如限定相册,按可用处理);
/// permanentlyDenied=永久拒绝(只能引导去设置);restricted=系统级限制(iOS 家长控制等,不可请求)。
enum PermissionAppState {
  granted,
  denied,
  limited,
  permanentlyDenied,
  restricted
}

/// 状态可用性判定(纯函数):granted/limited 视为可用,其余不可用。
bool isPermissionUsable(PermissionAppState state) =>
    state == PermissionAppState.granted || state == PermissionAppState.limited;

/// 平台通道桥接抽象:生产实现桥 permission_handler,单测注入 fake。
/// (与 network_status.dart 的 NetworkStatusSource 同范式:插件薄壳不进单测。)
abstract interface class PermissionGateway {
  Future<PermissionAppState> status(AppPermission permission);
  Future<PermissionAppState> request(AppPermission permission);
  Future<bool> openSettings();
}

/// 权限服务:业务唯一入口。
abstract interface class PermissionService {
  /// 查询当前状态(不触发系统弹窗)。
  Future<PermissionAppState> check(AppPermission permission);

  /// 发起系统授权请求;已是 granted/limited 直接返回;permanentlyDenied/restricted
  /// 不再触发系统弹窗,直接返回当前状态(请求语义由调用方结合说明弹窗编排)。
  Future<PermissionAppState> request(AppPermission permission);

  /// 跳系统设置页;返回是否成功打开。
  Future<bool> openSettings();
}
