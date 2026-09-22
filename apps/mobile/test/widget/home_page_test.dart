// ping 页三态 widget 测试(方案 §4 阶段 2.C):loading/success/failure,
// 数据源经 pumpApp 包装注入 FakePingRepository,不触真实网络。
import 'dart:async';

import 'package:cms_mobile/core/error/app_error.dart';
import 'package:cms_mobile/core/network/ping_repository.dart';
import 'package:cms_mobile/features/home/home_page.dart';
import 'package:cms_mobile/app_providers.dart';
import 'package:cms_mobile/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// 可编程替身:按调用次序返回(第一连击失败、重试成功的非法状态迁移用)。
class ScriptedPingRepository implements PingRepository {
  final List<Future<String> Function()> script;
  int _calls = 0;

  ScriptedPingRepository(this.script);

  @override
  Future<String> fetchMessage() {
    final index = _calls < script.length ? _calls : script.length - 1;
    _calls += 1;
    return script[index]();
  }
}

Future<void> pumpWith(WidgetTester tester, PingRepository repository) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [pingRepositoryProvider.overrideWithValue(repository)],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const HomePage(),
      ),
    ),
  );
}

void main() {
  testWidgets('loading 态渲染进度指示(请求未完成)', (tester) async {
    final completer = Completer<String>();
    await pumpWith(
      tester,
      ScriptedPingRepository([() => completer.future]),
    );
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    completer.complete('late');
    await tester.pumpAndSettle();
  });

  testWidgets('success 态渲染服务端 message', (tester) async {
    await pumpWith(
      tester,
      ScriptedPingRepository([() => Future.value('pong from app api')]),
    );
    await tester.pumpAndSettle();
    expect(find.text('pong from app api'), findsOneWidget);
  });

  testWidgets('failure 态渲染错误与重试入口;重试成功回到 success(非法状态迁移)', (tester) async {
    await pumpWith(
      tester,
      ScriptedPingRepository([
        () => Future.error(const AppError(code: 0, message: '网络连接失败')),
        () => Future.value('pong after retry'),
      ]),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('加载失败'), findsOneWidget);
    expect(find.text('重试'), findsOneWidget);

    await tester.tap(find.text('重试'));
    await tester.pumpAndSettle();
    expect(find.text('pong after retry'), findsOneWidget);
    expect(find.textContaining('加载失败'), findsNothing);
  });

  testWidgets('主题应用:AppBar 使用亮色主题', (tester) async {
    await pumpWith(
      tester,
      ScriptedPingRepository([() => Future.value('pong')]),
    );
    await tester.pumpAndSettle();
    final context = tester.element(find.byType(AppBar));
    expect(Theme.of(context).useMaterial3, isTrue);
  });
}
