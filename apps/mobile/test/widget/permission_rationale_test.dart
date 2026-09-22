// 权限说明弹窗 widget 测试(W 系列,阶段 6 方案 §4.1.4):
// permanentlyDenied=false → rationale + 「知道了」;true → settingsHint + 「去设置」返回 true;取消返回 false。
// 文案断言与 kPermissionCopyTable 逐字一致。
import 'package:cms_mobile/core/permission/permission_rationale.dart';
import 'package:cms_mobile/core/permission/permission_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// 渲染一个按钮,点击弹出 camera 权限说明弹窗;onShown 回传 showDialog 的 Future。
Future<void> _pumpTrigger(
  WidgetTester tester, {
  required bool permanentlyDenied,
  void Function(Future<bool?> dialogResult)? onShown,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (BuildContext context) => TextButton(
          onPressed: () {
            final Future<bool?> dialogResult = showPermissionRationaleDialog(
              context,
              permission: AppPermission.camera,
              permanentlyDenied: permanentlyDenied,
            );
            onShown?.call(dialogResult);
          },
          child: const Text('trigger'),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('W1 非永久拒绝:渲染 rationale 文案 + 「知道了」,不出现「去设置」', (tester) async {
    await _pumpTrigger(tester, permanentlyDenied: false);

    await tester.tap(find.text('trigger'));
    await tester.pumpAndSettle();

    final copy = kPermissionCopyTable[AppPermission.camera]!;
    expect(find.text(copy.rationale), findsOneWidget);
    expect(find.text(copy.settingsHint), findsNothing);
    expect(find.text('取消'), findsOneWidget);
    expect(find.text('知道了'), findsOneWidget);
    expect(find.text('去设置'), findsNothing);
  });

  testWidgets('W2 永久拒绝:渲染 settingsHint + 「去设置」,点击返回 true', (tester) async {
    Future<bool?>? dialogResult;
    await _pumpTrigger(
      tester,
      permanentlyDenied: true,
      onShown: (result) => dialogResult = result,
    );

    await tester.tap(find.text('trigger'));
    await tester.pumpAndSettle();

    final copy = kPermissionCopyTable[AppPermission.camera]!;
    expect(find.text(copy.settingsHint), findsOneWidget);
    expect(find.text('去设置'), findsOneWidget);

    await tester.tap(find.text('去设置'));
    await tester.pumpAndSettle();
    expect(await dialogResult, isTrue);
  });

  testWidgets('W3 点「取消」返回 false', (tester) async {
    Future<bool?>? dialogResult;
    await _pumpTrigger(
      tester,
      permanentlyDenied: true,
      onShown: (result) => dialogResult = result,
    );

    await tester.tap(find.text('trigger'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(await dialogResult, isFalse);
  });
}
