// NetworkStatusService 单测(方案 §4.3 NS1–NS8):
// source 用 fake 注入,Stream 用 StreamController 手动喂;插件薄壳
// ConnectivityNetworkStatusSource 不测(本机无 Flutter 插件环境,方案易错点 12)。
import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mobile/app_providers.dart';
import 'package:cms_mobile/core/network/network_status.dart';

/// 状态源替身:current 可编程(成功值或抛错),onChange 用手动喂的广播流。
class _FakeSource implements NetworkStatusSource {
  final StreamController<NetworkStatus> controller =
      StreamController<NetworkStatus>.broadcast();

  NetworkStatus currentResult = NetworkStatus.unknown;
  Object? currentError;

  /// onChange 被访问的次数(start 幂等用)。
  int onChangeAccessCount = 0;

  void emit(NetworkStatus status) {
    controller.add(status);
  }

  @override
  Future<NetworkStatus> current() async {
    final error = currentError;
    if (error != null) {
      throw error;
    }
    return currentResult;
  }

  @override
  Stream<NetworkStatus> get onChange {
    onChangeAccessCount += 1;
    return controller.stream;
  }
}

void main() {
  group('mapConnectivityResults', () {
    test('链路列表映射三态(NS1)', () {
      expect(mapConnectivityResults(const []), NetworkStatus.offline);
      expect(
        mapConnectivityResults(const [ConnectivityResult.none]),
        NetworkStatus.offline,
      );
      expect(
        mapConnectivityResults(const [ConnectivityResult.wifi]),
        NetworkStatus.online,
      );
      expect(
        mapConnectivityResults(const [
          ConnectivityResult.none,
          ConnectivityResult.mobile,
        ]),
        NetworkStatus.online,
      );
      expect(
        mapConnectivityResults(const [ConnectivityResult.bluetooth]),
        NetworkStatus.online,
      );
    });
  });

  group('NetworkStatusService', () {
    test('初始态 unknown,stream 未发事件(NS2)', () async {
      final source = _FakeSource();
      final service = NetworkStatusService(source: source);
      final events = <NetworkStatus>[];
      final sub = service.stream.listen(events.add);
      await pumpEventQueue();

      expect(service.current, NetworkStatus.unknown);
      expect(events, isEmpty);

      await sub.cancel();
      await service.dispose();
    });

    test('start 订阅 + 同值去重:offline 只广播一次(NS3)', () async {
      final source = _FakeSource();
      final service = NetworkStatusService(source: source)..start();
      final events = <NetworkStatus>[];
      final sub = service.stream.listen(events.add);
      await pumpEventQueue();

      source.emit(NetworkStatus.offline);
      await pumpEventQueue();
      source.emit(NetworkStatus.offline);
      await pumpEventQueue();
      source.emit(NetworkStatus.online);
      await pumpEventQueue();

      expect(
        events,
        <NetworkStatus>[NetworkStatus.offline, NetworkStatus.online],
      );
      expect(service.current, NetworkStatus.online);

      await sub.cancel();
      await service.dispose();
    });

    test('refresh 成功更新 current 并广播一次(NS4)', () async {
      final source = _FakeSource()..currentResult = NetworkStatus.online;
      final service = NetworkStatusService(source: source);
      final events = <NetworkStatus>[];
      final sub = service.stream.listen(events.add);

      await service.refresh();
      await pumpEventQueue();

      expect(service.current, NetworkStatus.online);
      expect(events, <NetworkStatus>[NetworkStatus.online]);

      await sub.cancel();
      await service.dispose();
    });

    test('refresh 失败保持旧值不抛(NS5)', () async {
      final source = _FakeSource()..currentResult = NetworkStatus.online;
      final service = NetworkStatusService(source: source);
      await service.refresh();
      expect(service.current, NetworkStatus.online);

      source.currentError = StateError('read failed');
      final events = <NetworkStatus>[];
      final sub = service.stream.listen(events.add);

      await service.refresh();
      await pumpEventQueue();

      expect(service.current, NetworkStatus.online);
      expect(events, isEmpty);

      await sub.cancel();
      await service.dispose();
    });

    test('dispose 后静默:喂流与 refresh 均无效且不抛(NS6)', () async {
      final source = _FakeSource()..currentResult = NetworkStatus.online;
      final service = NetworkStatusService(source: source)..start();
      await service.dispose();

      final events = <NetworkStatus>[];
      final sub = service.stream.listen(events.add);
      source.emit(NetworkStatus.online);
      await service.refresh();
      await pumpEventQueue();

      expect(service.current, NetworkStatus.unknown);
      expect(events, isEmpty);

      await sub.cancel();
      await service.dispose(); // 幂等,不抛
    });

    test('start 幂等:源流只被订阅一次(NS7)', () async {
      final source = _FakeSource();
      final service = NetworkStatusService(source: source)
        ..start()
        ..start();

      expect(source.onChangeAccessCount, 1);

      await service.dispose();
    });

    test('装配层 Provider 可经 override 注入 fake source 的 service(NS8)', () async {
      final source = _FakeSource();
      final service = NetworkStatusService(source: source);
      final container = ProviderContainer(
        overrides: [networkStatusServiceProvider.overrideWithValue(service)],
      );
      addTearDown(container.dispose);

      expect(container.read(networkStatusServiceProvider), same(service));
      // 既有 pump_app/home_page widget 测试不读网络状态服务,不改文件即回归。
    });
  });
}
