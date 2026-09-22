/// 校验并归一化 webview 目标 URL:仅放行 http/https;非法(空/解析失败/非 http(s))返回 null。
/// 归一化 = Uri.parse 后的原始串(trim 后);不做额外改写。
String? validateWebViewUrl(String? raw) {
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
