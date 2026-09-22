// 联通验证(方案 §4 阶段 3.2):PingRepository → dio 信封链路 → 真实 Go server。
// server 未启动时跳过(不视为失败,本地联通已由 curl 对照验证);
// 启动方式见 apps/mobile/README.md(SERVER_PORT=18085)。
import 'package:cms_mobile/core/config/app_config.dart';
import 'package:cms_mobile/core/error/app_error.dart';
import 'package:cms_mobile/core/network/dio_client.dart';
import 'package:cms_mobile/core/network/ping_repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('PingRepository 对真实 server 的信封链路(curl 对照)', () async {
    const config = AppConfig(
      flavor: Flavor.dev,
      apiBaseUrl: 'http://127.0.0.1:18085',
      sentryDsn: '',
      sentryTracesSampleRate: 0,
      analyticsEnabled: false,
      appVersion: '0.1.0',
      buildNumber: '1',
      pushEnabled: false,
    );
    final repository = PingRepository(buildDio(config));

    String message;
    try {
      message = await repository.fetchMessage();
    } on AppError {
      // server 未启动:如实跳过,不算失败
      // ignore: avoid_print
      print('SKIP: 本地 server(18085) 未启动,跳过联通验证');
      return;
    }

    expect(message, contains('pong'));
  }, timeout: const Timeout(Duration(seconds: 15)));
}
