import 'package:flutter/material.dart';

/// 页面四态:loading(加载中)/ empty(空数据)/ error(失败可重试)/ success(内容)。
enum PageStatus { loading, empty, error, success }

/// 默认空态文案。
const String kDefaultEmptyMessage = '暂无数据';

/// 默认失败文案。
const String kDefaultErrorMessage = '加载失败';

/// 重试按钮文案。
const String kRetryLabel = '重试';

/// 四态判定纯函数:优先级 loading > error > empty > success。
/// (加载中覆盖一切;失败优先于空态——失败重试入口不能被空态吞掉。)
PageStatus resolvePageStatus({
  required bool isLoading,
  required bool hasError,
  required bool isEmpty,
}) {
  if (isLoading) return PageStatus.loading;
  if (hasError) return PageStatus.error;
  if (isEmpty) return PageStatus.empty;
  return PageStatus.success;
}

/// 通用页面状态视图:四态渲染 + 可选重试入口。
/// 页面只负责把业务状态映射成 PageStatus(经 resolvePageStatus),视图不含业务逻辑。
class PageStateView extends StatelessWidget {
  const PageStateView({
    super.key,
    required this.status,
    this.emptyMessage = kDefaultEmptyMessage,
    this.errorMessage,
    this.onRetry,
    this.child = const SizedBox.shrink(),
  });

  /// 当前状态(必填)。
  final PageStatus status;

  /// 空态文案;null/纯空白回退 [kDefaultEmptyMessage]。
  final String emptyMessage;

  /// 失败文案;null/纯空白回退 [kDefaultErrorMessage]。
  final String? errorMessage;

  /// 重试回调;null = error 态不渲染重试按钮。
  final VoidCallback? onRetry;

  /// success 态内容。
  final Widget child;

  @override
  Widget build(BuildContext context) {
    switch (status) {
      case PageStatus.loading:
        return const Center(
          key: ValueKey<String>('page-state.loading'),
          child: CircularProgressIndicator(),
        );
      case PageStatus.empty:
        return Center(
          key: const ValueKey<String>('page-state.empty'),
          child: Text(_normalize(emptyMessage, kDefaultEmptyMessage)),
        );
      case PageStatus.error:
        return Center(
          key: const ValueKey<String>('page-state.error'),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_normalize(errorMessage, kDefaultErrorMessage)),
              if (onRetry != null) ...[
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  key: const ValueKey<String>('page-state.retry'),
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh),
                  label: const Text(kRetryLabel),
                ),
              ],
            ],
          ),
        );
      case PageStatus.success:
        return KeyedSubtree(
          key: const ValueKey<String>('page-state.success'),
          child: child,
        );
    }
  }

  static String _normalize(String? value, String fallback) {
    final v = value?.trim();
    return v == null || v.isEmpty ? fallback : v;
  }
}
