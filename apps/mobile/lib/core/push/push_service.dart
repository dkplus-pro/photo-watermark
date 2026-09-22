import 'dart:async';

/// native 收到推送后拟向 H5 派发的事件名(决策 7 预留;本期仅常量与注释,不实现派发)。
/// 派发通道:webview 容器 evaluateJavascript
/// `window.__JSB_BRIDGE__.dispatchEvent(kPushMessageEvent, payload)`。
const String kPushMessageEvent = 'push.message';

/// 推送消息协议:type 决定跳转路由(映射表见 push_route.dart),payload 为业务载荷。
class PushMessage {
  const PushMessage({
    required this.type,
    this.payload = const <String, dynamic>{},
  });

  final String type;
  final Map<String, dynamic> payload;
}

/// Push 抽象(决策 7):SDK(FCM/厂商通道)后接,只换实现。
abstract interface class PushService {
  /// 初始化(权限申请/SDK 注册);重复调用幂等。
  Future<void> init();

  /// 前台/通知点击消息流(广播)。
  Stream<PushMessage> get onMessage;

  /// 冷启动携带的消息;无 → null。
  Future<PushMessage?> getInitialMessage();
}

/// 默认实现(PUSH_ENABLED=false 或 SDK 未接入):全 no-op,流为空广播流。
class NoopPushService implements PushService {
  const NoopPushService();

  @override
  Future<void> init() async {}

  @override
  Stream<PushMessage> get onMessage => const Stream<PushMessage>.empty();

  @override
  Future<PushMessage?> getInitialMessage() async => null;
}
