/// 埋点抽象:Console/Sentry 双实现可切(M2.B),总开关见 AppConfig.analyticsEnabled。
/// 命名规范与 miniapp 对齐:`page_view` 内建,其余自定义事件用 资源.动作 蛇形命名。
abstract interface class EventTracker {
  void pageView(String path, {Map<String, Object?>? properties});

  void track(String name, {Map<String, Object?>? properties});

  /// 元素曝光(决策 11,与 miniapp track.expose 对齐):事件名 'expose',属性含 trackId。
  void expose(String trackId, {Map<String, Object?>? properties});
}
