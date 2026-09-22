import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_providers.dart';
import 'features/home/home_providers.dart';
import 'l10n/supported_locales.dart';
import 'router/app_router.dart';
import 'theme/app_theme.dart';

/// 应用根组件:MaterialApp.router 挂载路由/主题/l10n;具体服务实例经
/// ProviderScope overrides 注入(见 app_providers.dart),本组件不感知实现。
class CmsMobileApp extends ConsumerStatefulWidget {
  const CmsMobileApp({super.key});

  @override
  ConsumerState<CmsMobileApp> createState() => _CmsMobileAppState();
}

class _CmsMobileAppState extends ConsumerState<CmsMobileApp> {
  @override
  void initState() {
    super.initState();
    // 生命周期与网络状态接线(阶段 4.3):服务实例来自装配层,启动幂等。
    ref.read(appLifecycleServiceProvider).start();
    final network = ref.read(networkStatusServiceProvider)..start();
    unawaited(network.refresh());
  }

  @override
  Widget build(BuildContext context) {
    // 读取一次,确保 logger 等随装配初始化(无副作用读取)。
    ref.watch(appLoggerProvider);
    ref.watch(pingProvider);

    return MaterialApp.router(
      title: 'CMS Mobile',
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeMode.system,
      routerConfig: appRouter,
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: supportedLocales,
    );
  }
}
