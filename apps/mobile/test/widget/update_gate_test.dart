// UpdateGate widget 测试(卡 7.4,待 Flutter 环境执行):
// force 弹窗不可关闭(无「稍后再说」、barrierDismissible=false)、optional 可关闭、
// downloadUrl 空 → 「立即更新」置灰、中文文案逐字断言。
import 'package:cms_mobile/app_providers.dart';
import 'package:cms_mobile/features/update/update_gate.dart';
import 'package:cms_mobile/theme/app_theme.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mobile/core/network/version_repository.dart';

class _StubVersionRepository implements VersionRepository {
  _StubVersionRepository(this._data);

  final VersionCheckData? _data;

  @override
  Future<VersionCheckData> check({
    required String platform,
    required String version,
    CancelToken? cancelToken,
  }) async =>
      _data ??
      (
        hasUpdate: false,
        forceUpdate: false,
        latestVersion: '',
        downloadUrl: '',
        releaseNotes: '',
      );
}

Future<void> _pumpGate(
  WidgetTester tester, {
  required VersionCheckData remote,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        versionRepositoryProvider
            .overrideWithValue(_StubVersionRepository(remote)),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const UpdateGate(child: SizedBox()),
      ),
    ),
  );
  // 首帧 postFrameCallback 触发 _check,再等 showDialog 动画。
  await tester.pump();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('optional 弹窗:标题/按钮文案逐字,可关闭', (WidgetTester tester) async {
    await _pumpGate(
      tester,
      remote: (
        hasUpdate: true,
        forceUpdate: false,
        latestVersion: '1.2.0',
        downloadUrl: 'https://example.com/app.apk',
        releaseNotes: '',
      ),
    );

    expect(find.text('发现新版本 V1.2.0'), findsOneWidget);
    expect(find.text('建议更新到最新版本以获得更好体验。'), findsOneWidget);
    expect(find.text('稍后再说'), findsOneWidget);
    expect(find.text('立即更新'), findsOneWidget);

    await tester.tap(find.text('稍后再说'));
    await tester.pumpAndSettle();
    expect(find.text('发现新版本 V1.2.0'), findsNothing);
  });

  testWidgets('force 弹窗:标题「重要更新」+固定文案,无「稍后再说」,barrierDismissible=false', (
    WidgetTester tester,
  ) async {
    await _pumpGate(
      tester,
      remote: (
        hasUpdate: true,
        forceUpdate: true,
        latestVersion: '2.0.0',
        downloadUrl: 'https://example.com/app.apk',
        releaseNotes: '必须更新说明',
      ),
    );

    expect(find.text('重要更新'), findsOneWidget);
    expect(find.text('当前版本已停止服务,请更新后继续使用。\n必须更新说明'), findsOneWidget);
    expect(find.text('稍后再说'), findsNothing);

    // 点 barrier(对话框外)不关闭。
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();
    expect(find.text('重要更新'), findsOneWidget);
  });

  testWidgets('downloadUrl 空 → 「立即更新」置灰', (WidgetTester tester) async {
    await _pumpGate(
      tester,
      remote: (
        hasUpdate: true,
        forceUpdate: false,
        latestVersion: '1.2.0',
        downloadUrl: '',
        releaseNotes: '',
      ),
    );

    final Finder button = find.ancestor(
      of: find.text('立即更新'),
      matching: find.byType(FilledButton),
    );
    final FilledButton filled = tester.widget<FilledButton>(button);
    expect(filled.onPressed, isNull);
  });

  testWidgets('hasUpdate=false → 不弹窗', (WidgetTester tester) async {
    await _pumpGate(
      tester,
      remote: (
        hasUpdate: false,
        forceUpdate: false,
        latestVersion: '9.9.9',
        downloadUrl: 'https://example.com/app.apk',
        releaseNotes: '',
      ),
    );
    expect(find.text('发现新版本 V9.9.9'), findsNothing);
  });
}
