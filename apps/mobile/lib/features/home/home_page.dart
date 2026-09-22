import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cms_mobile/core/ui/page_state.dart';

import 'home_providers.dart';

/// ping 页(业务接入范式样板):三态渲染(loading/success/failure),
/// 状态映射经 PageStateView(core/ui),页面不持有业务逻辑。
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ping = ref.watch(pingProvider);
    final error = ping.hasError ? ping.error : null;

    return Scaffold(
      appBar: AppBar(title: const Text('CMS Mobile')),
      body: Center(
        child: PageStateView(
          status: resolvePageStatus(
            isLoading: ping is AsyncLoading,
            hasError: ping.hasError,
            isEmpty: false, // ping 消息串无空态语义,空串按成功渲染(保持现状)
          ),
          errorMessage: error == null ? null : '加载失败:$error',
          onRetry: () => ref.read(pingProvider.notifier).retry(),
          child: switch (ping) {
            AsyncValue(:final value?) => Text(
                value,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            _ => const SizedBox.shrink(),
          },
        ),
      ),
    );
  }
}
