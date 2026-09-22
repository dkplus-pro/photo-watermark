import 'package:flutter/material.dart';

/// 主题令牌唯一入口:亮/暗两套 ThemeData;design tokens(品牌色板等)后续由
/// 设计输入填充,此处仅占位(M1.3 接口冻结时的约定)。
/// 业务禁止在组件里散落颜色/字号字面量,统一经 Theme.of(context) 取用。
class AppTheme {
  AppTheme._();

  static ThemeData light() => _base(Brightness.light);

  static ThemeData dark() => _base(Brightness.dark);

  static ThemeData _base(Brightness brightness) {
    final colorScheme = ColorScheme.fromSeed(seedColor: const Color(0xFF0052CC), brightness: brightness);
    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      appBarTheme: const AppBarTheme(centerTitle: true),
    );
  }
}
