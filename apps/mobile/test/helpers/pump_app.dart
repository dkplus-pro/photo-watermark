// Widget 测试公用包装(方案 §3 test/helpers):统一 ProviderScope 装配,
// 测试经 overrides 替换 PingRepository 数据源,不触真实网络。
import 'package:cms_mobile/core/error/app_error.dart';
import 'package:cms_mobile/core/network/ping_repository.dart';
import 'package:cms_mobile/features/home/home_page.dart';
import 'package:cms_mobile/app_providers.dart';
import 'package:cms_mobile/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// 测试用 PingRepository 替身:构造时决定成功载荷或失败错误。
class FakePingRepository implements PingRepository {
  FakePingRepository.success(String message)
      : _message = message,
        _error = null;

  FakePingRepository.failure(AppError error)
      : _message = null,
        _error = error;

  final String? _message;
  final AppError? _error;

  @override
  Future<String> fetchMessage() async {
    final error = _error;
    if (error != null) {
      throw error;
    }
    return _message ?? '';
  }
}

/// 渲染 HomePage(主题 + ProviderScope 包装),overrides 注入替身数据源。
Future<void> pumpHomePage(
  WidgetTester tester, {
  required FakePingRepository repository,
}) async {
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
