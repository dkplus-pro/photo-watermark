// Push 抽象单测(卡 7.2 PU1):NoopPushService 三方法行为。
import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mobile/core/push/push_service.dart';

void main() {
  group('NoopPushService(PU1)', () {
    const NoopPushService service = NoopPushService();

    test('init 幂等不抛', () async {
      await service.init();
      await service.init();
    });

    test('getInitialMessage 恒为 null', () async {
      expect(await service.getInitialMessage(), isNull);
    });

    test('onMessage 为空流(首事件前即关闭,无事件)', () async {
      final List<PushMessage> received = await service.onMessage.toList();
      expect(received, isEmpty);
    });
  });
}
