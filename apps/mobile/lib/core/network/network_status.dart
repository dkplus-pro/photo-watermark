import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

/// 网络状态三态:unknown = 尚未取得或读取失败(初始值)。
enum NetworkStatus { online, offline, unknown }

/// connectivity_plus v6 结果(链路列表)→ 三态;纯函数便于单测。
/// 空列表或全部为 none → offline;存在任一真实链路 → online。
NetworkStatus mapConnectivityResults(List<ConnectivityResult> results) {
  if (results.isEmpty) return NetworkStatus.offline;
  final hasLink = results.any((r) => r != ConnectivityResult.none);
  return hasLink ? NetworkStatus.online : NetworkStatus.offline;
}

/// 状态源抽象:生产实现桥接 connectivity_plus,单测注入 fake。
abstract interface class NetworkStatusSource {
  Future<NetworkStatus> current();
  Stream<NetworkStatus> get onChange;
}

/// connectivity_plus 桥接实现(插件薄壳,单测不触)。
class ConnectivityNetworkStatusSource implements NetworkStatusSource {
  ConnectivityNetworkStatusSource([Connectivity? connectivity])
      : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;

  @override
  Future<NetworkStatus> current() async =>
      mapConnectivityResults(await _connectivity.checkConnectivity());

  @override
  Stream<NetworkStatus> get onChange =>
      _connectivity.onConnectivityChanged.map(mapConnectivityResults);
}

/// 网络状态服务:首值 unknown;start() 开始订阅,refresh() 主动拉一次。
/// 读取失败保持旧值不抛错(状态感知是辅助能力,永不阻塞主流程)。
/// stream 只发「值变化」(广播,不回放;消费方先读 current 再听 stream)。
class NetworkStatusService {
  NetworkStatusService({required NetworkStatusSource source})
      : _source = source;

  final NetworkStatusSource _source;
  final StreamController<NetworkStatus> _controller =
      StreamController<NetworkStatus>.broadcast();

  NetworkStatus _current = NetworkStatus.unknown;
  StreamSubscription<NetworkStatus>? _subscription;
  bool _started = false;
  bool _disposed = false;

  NetworkStatus get current => _current;
  Stream<NetworkStatus> get stream => _controller.stream;

  /// 开始订阅状态源;重复调用幂等。
  void start() {
    if (_started || _disposed) return;
    _started = true;
    _subscription = _source.onChange.listen(_apply);
  }

  /// 主动刷新一次;源读取失败保持旧值(吞错)。
  Future<void> refresh() async {
    if (_disposed) return;
    try {
      _apply(await _source.current());
    } catch (_) {
      // 读取失败保持旧值,不阻塞调用方
    }
  }

  /// 值去重应用:同值不重复广播(非法状态迁移护栏)。
  void _apply(NetworkStatus next) {
    if (_disposed || next == _current) return;
    _current = next;
    _controller.add(next);
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _subscription?.cancel();
    await _controller.close();
  }
}
