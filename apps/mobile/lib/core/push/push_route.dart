import 'push_service.dart';

/// 推送点击路由映射(纯函数)。结果 null = 不跳转(未知类型/非法载荷,降级不阻断)。
///
/// 映射表(锁定,新增 type 需评审):
/// - `home`    → `/`(payload 忽略)
/// - `webview` → `/webview?url=<payload.url>`(url 必填且须为 http/https;可带 payload.title)
String? resolvePushRoute(PushMessage message) {
  switch (message.type) {
    case 'home':
      return '/';
    case 'webview':
      final Object? url = message.payload['url'];
      final String? validated = _validateHttpUrl(url is String ? url : null);
      if (validated == null) {
        return null;
      }
      final Object? title = message.payload['title'];
      final String titleSuffix = title is String && title.isNotEmpty
          ? '&title=${Uri.encodeQueryComponent(title)}'
          : '';
      return '/webview?url=${Uri.encodeQueryComponent(validated)}$titleSuffix';
    default:
      return null;
  }
}

/// 与 core/hybrid/webview_url.dart 语义保持一致(仅放行 http/https),刻意
/// 内联而不 import,守 core 模块零耦合(不新增 AGENTS 例外)。
String? _validateHttpUrl(String? raw) {
  final String? trimmed = raw?.trim();
  if (trimmed == null || trimmed.isEmpty) {
    return null;
  }
  final Uri uri;
  try {
    uri = Uri.parse(trimmed);
  } catch (_) {
    return null;
  }
  final String scheme = uri.scheme.toLowerCase();
  if (scheme != 'http' && scheme != 'https') {
    return null;
  }
  return trimmed;
}
