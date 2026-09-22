// WebViewPage widget 测试(WP 系列,方案 §6.7,最小化):
// 仅覆盖不触平台视图的分支(非法 URL 渲染错误态);合法 URL 加载(WP2)待 Flutter 环境。
//
// WP2(待 Flutter 环境执行):WebViewPage(url: 'https://...') 合法分支会构建 InAppWebView,
// 平台视图在 widget 测试环境不可用,无法本地验证;联调按 docs/hybrid-capability-plan.md §8 runbook 执行。
import 'package:cms_mobile/app_providers.dart';
import 'package:cms_mobile/core/config/app_config.dart';
import 'package:cms_mobile/features/webview/webview_page.dart';
import 'package:cms_mobile/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

AppConfig _testConfig() => const AppConfig(
      flavor: Flavor.dev,
      apiBaseUrl: 'http://test.local',
      sentryDsn: '',
      sentryTracesSampleRate: 0,
      analyticsEnabled: false,
      appVersion: '0.1.0',
      buildNumber: '1',
      pushEnabled: false,
    );

Future<void> _pumpPage(WidgetTester tester, {String? url}) async {
  await tester.pumpWidget(
    ProviderScope(
      // 非法 URL 分支只触 appConfigProvider(initState 装配读);
      // readNetworkType 是惰性闭包,非法分支不会读 networkStatusServiceProvider。
      overrides: [appConfigProvider.overrideWithValue(_testConfig())],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: WebViewPage(url: url),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('WP1 非法 URL(ftp)渲染错误态,不构建 InAppWebView', (tester) async {
    await _pumpPage(tester, url: 'ftp://x');

    expect(
      find.byKey(const ValueKey<String>('page-state.error')),
      findsOneWidget,
    );
    expect(find.text('链接无效或仅支持 http/https'), findsOneWidget);
    expect(find.byType(InAppWebView), findsNothing);
  });

  testWidgets('WP1b url 为 null(直构)同样渲染错误态', (tester) async {
    await _pumpPage(tester);

    expect(
      find.byKey(const ValueKey<String>('page-state.error')),
      findsOneWidget,
    );
    expect(find.text('链接无效或仅支持 http/https'), findsOneWidget);
    expect(find.byType(InAppWebView), findsNothing);
  });
}
