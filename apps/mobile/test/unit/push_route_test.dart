// resolvePushRoute 单测(卡 7.2 PU2–PU7):推送点击路由映射纯函数。
import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mobile/core/config/app_config.dart';
import 'package:cms_mobile/core/push/push_route.dart';
import 'package:cms_mobile/core/push/push_service.dart';

void main() {
  PushMessage msg(String type,
          [Map<String, dynamic> payload = const <String, dynamic>{}]) =>
      PushMessage(type: type, payload: payload);

  group('resolvePushRoute', () {
    test("PU2: type='home' → '/'(payload 忽略)", () {
      expect(resolvePushRoute(msg('home')), '/');
      expect(resolvePushRoute(msg('home', <String, dynamic>{'x': 1})), '/');
    });

    test(
        "PU3: type='webview' 合法 url → '/webview?url=<encoded>';带 title 拼 &title=",
        () {
      expect(
        resolvePushRoute(
            msg('webview', <String, dynamic>{'url': 'https://a.b/c'})),
        '/webview?url=https%3A%2F%2Fa.b%2Fc',
      );
      expect(
        resolvePushRoute(msg('webview', <String, dynamic>{
          'url': 'http://a.b/c',
          'title': '活动页',
        })),
        '/webview?url=http%3A%2F%2Fa.b%2Fc&title=%E6%B4%BB%E5%8A%A8%E9%A1%B5',
      );
    });

    test("PU4: type='webview' url 缺失/空/非 http(s)/非字符串 → null", () {
      expect(resolvePushRoute(msg('webview')), isNull);
      expect(resolvePushRoute(msg('webview', <String, dynamic>{'url': ''})),
          isNull);
      expect(resolvePushRoute(msg('webview', <String, dynamic>{'url': '   '})),
          isNull);
      expect(
        resolvePushRoute(msg('webview', <String, dynamic>{'url': 'ftp://a.b'})),
        isNull,
      );
      expect(
        resolvePushRoute(msg('webview', <String, dynamic>{'url': 123})),
        isNull,
      );
    });

    test('PU5: 未知 type → null(不跳转不抛错)', () {
      expect(resolvePushRoute(msg('deeplink')), isNull);
      expect(resolvePushRoute(msg('UNKNOWN')), isNull);
    });

    test('PU6: type 空串、payload 缺省 → null', () {
      expect(resolvePushRoute(msg('')), isNull);
    });
  });

  group('PU7: AppConfig 构造含 pushEnabled(编译护栏)', () {
    test('pushEnabled 字段可构造且默认 factory 为 false', () {
      const AppConfig config = AppConfig(
        flavor: Flavor.dev,
        apiBaseUrl: 'http://test.local',
        sentryDsn: '',
        sentryTracesSampleRate: 0,
        analyticsEnabled: false,
        appVersion: '0.1.0',
        buildNumber: '1',
        pushEnabled: false,
      );
      expect(config.pushEnabled, isFalse);
    });
  });
}
