// PageStateView 四态 widget 测试(方案 §4.1 PS1–PS8):
// 组件不读 Provider,直接 MaterialApp(theme) + Scaffold 包装,无需 ProviderScope。
// 既有 home_page_test.dart 的 4 例是重构回归护栏(不改文件,待 Flutter 环境执行)。
import 'package:cms_mobile/core/ui/page_state.dart';
import 'package:cms_mobile/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> pumpView(WidgetTester tester, PageStateView view) async {
  // 不用 pumpAndSettle:loading 态的 CircularProgressIndicator 永不停止。
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light(),
      home: Scaffold(body: view),
    ),
  );
}

void main() {
  group('resolvePageStatus', () {
    test('优先级 loading > error > empty > success(PS1)', () {
      expect(
        resolvePageStatus(isLoading: true, hasError: true, isEmpty: true),
        PageStatus.loading,
      );
      expect(
        resolvePageStatus(isLoading: false, hasError: true, isEmpty: true),
        PageStatus.error,
      );
      expect(
        resolvePageStatus(isLoading: false, hasError: false, isEmpty: true),
        PageStatus.empty,
      );
      expect(
        resolvePageStatus(isLoading: false, hasError: false, isEmpty: false),
        PageStatus.success,
      );
    });
  });

  group('PageStateView', () {
    testWidgets('loading 态渲染进度指示,不渲染 child(PS2)', (tester) async {
      await pumpView(
        tester,
        const PageStateView(
          status: PageStatus.loading,
          child: Text('内容'),
        ),
      );

      expect(
        find.byKey(const ValueKey<String>('page-state.loading')),
        findsOneWidget,
      );
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('内容'), findsNothing);
    });

    testWidgets('empty 态不传 emptyMessage 回退默认文案(PS3)', (tester) async {
      await pumpView(tester, const PageStateView(status: PageStatus.empty));

      expect(
        find.byKey(const ValueKey<String>('page-state.empty')),
        findsOneWidget,
      );
      expect(find.text('暂无数据'), findsOneWidget);
    });

    testWidgets('empty/error 文案纯空白回退默认(PS4)', (tester) async {
      await pumpView(
        tester,
        const PageStateView(status: PageStatus.empty, emptyMessage: '  '),
      );
      expect(find.text('暂无数据'), findsOneWidget);

      await pumpView(
        tester,
        const PageStateView(status: PageStatus.error, errorMessage: ' '),
      );
      expect(find.text('加载失败'), findsOneWidget);
    });

    testWidgets('error 态渲染自定义文案;点重试回调被调一次(PS5)', (tester) async {
      var retryCalls = 0;
      await pumpView(
        tester,
        PageStateView(
          status: PageStatus.error,
          errorMessage: '自定义错误',
          onRetry: () => retryCalls++,
        ),
      );

      expect(find.text('自定义错误'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey<String>('page-state.retry')));
      await tester.pump();
      expect(retryCalls, 1);
    });

    testWidgets('error 态无 onRetry 不渲染重试按钮(PS6)', (tester) async {
      await pumpView(tester, const PageStateView(status: PageStatus.error));

      expect(
        find.byKey(const ValueKey<String>('page-state.retry')),
        findsNothing,
      );
      expect(find.text('加载失败'), findsOneWidget);
    });

    testWidgets('success 态渲染 child,不渲染进度/文案/按钮(PS7)', (tester) async {
      await pumpView(
        tester,
        const PageStateView(
          status: PageStatus.success,
          child: Text('内容'),
        ),
      );

      expect(
        find.byKey(const ValueKey<String>('page-state.success')),
        findsOneWidget,
      );
      expect(find.text('内容'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.text('暂无数据'), findsNothing);
      expect(
        find.byKey(const ValueKey<String>('page-state.retry')),
        findsNothing,
      );
    });

    testWidgets('同一 tester 依次切换四态,旧 key 消失新 key 出现(PS8)', (tester) async {
      const loadingKey = ValueKey<String>('page-state.loading');
      const emptyKey = ValueKey<String>('page-state.empty');
      const errorKey = ValueKey<String>('page-state.error');
      const successKey = ValueKey<String>('page-state.success');

      await pumpView(tester, const PageStateView(status: PageStatus.loading));
      expect(find.byKey(loadingKey), findsOneWidget);

      await pumpView(tester, const PageStateView(status: PageStatus.empty));
      expect(find.byKey(loadingKey), findsNothing);
      expect(find.byKey(emptyKey), findsOneWidget);

      await pumpView(tester, const PageStateView(status: PageStatus.error));
      expect(find.byKey(emptyKey), findsNothing);
      expect(find.byKey(errorKey), findsOneWidget);

      await pumpView(
        tester,
        const PageStateView(
          status: PageStatus.success,
          child: Text('内容'),
        ),
      );
      expect(find.byKey(errorKey), findsNothing);
      expect(find.byKey(successKey), findsOneWidget);
    });
  });
}
