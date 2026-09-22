// l10n 占位:当前壳阶段无业务文案,暂不引入 intl 生成链(pubspec generate: true 留坑,
// 待首个用户可见字符串出现时启用 flutter gen-l10n + arb 资源)。
// 约定:所有用户可见文案禁止硬编码在组件里,统一走 AppLocalizations(接线在 app.dart)。

// 本文件先提供受支持语言清单,供 MaterialApp.router 的 supportedLocales 引用,
// 避免各处散写 Locale 常量。
import 'dart:ui';

/// 应用支持的语区(顺序即回退优先级,zh 为默认)。
const supportedLocales = <Locale>[Locale('zh'), Locale('en')];
