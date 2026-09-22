import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../features/home/home_page.dart';
import '../features/update/update_gate.dart';
import '../features/webview/webview_page.dart';

/// 路由表(go_router,官方):路由独立于页面,天然支持路由级性能事务(M3.1 接 PerformanceMonitor);
/// 路径外的未知路由渲染错误页(路由级兜底)。
final appRouter = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(path: '/', builder: (context, state) => const UpdateGate(child: HomePage())),
    GoRoute(
      path: '/webview',
      builder: (context, state) => WebViewPage(
        url: state.uri.queryParameters['url'],
        title: state.uri.queryParameters['title'],
      ),
    ),
  ],
  errorBuilder: (context, state) => _RouteErrorPage(error: state.error),
);

/// 路由错误页:未知路径/路由级异常的统一兜底。
class _RouteErrorPage extends StatelessWidget {
  const _RouteErrorPage({required this.error});

  final Object? error;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('页面不存在')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('页面不存在或加载失败'),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () => context.go('/'),
              child: const Text('返回首页'),
            ),
            const SizedBox(height: 8),
            Text('$error', style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}
