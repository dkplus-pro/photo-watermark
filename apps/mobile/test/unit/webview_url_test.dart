// validateWebViewUrl 单测(W 系列,方案 §6.5):http/https 白名单与归一化。
import 'package:cms_mobile/core/hybrid/webview_url.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('validateWebViewUrl', () {
    test('W1 空值(null/空串/纯空白)→ null', () {
      expect(validateWebViewUrl(null), isNull);
      expect(validateWebViewUrl(''), isNull);
      expect(validateWebViewUrl('   '), isNull);
    });

    test('W2 解析失败 → null 且不抛', () {
      expect(validateWebViewUrl('://'), isNull);
    });

    test('W3 非 http(s) 协议全拒(ftp/file/javascript/about)', () {
      expect(validateWebViewUrl('ftp://a'), isNull);
      expect(validateWebViewUrl('file:///x'), isNull);
      expect(validateWebViewUrl('javascript:alert(1)'), isNull);
      expect(validateWebViewUrl('about:blank'), isNull);
    });

    test('W4 合法 http/https(含 query/fragment)→ 原串返回', () {
      expect(validateWebViewUrl('http://a.b'), 'http://a.b');
      expect(
        validateWebViewUrl('https://a.b/p?q=1#f'),
        'https://a.b/p?q=1#f',
      );
    });

    test('W5 大小写 scheme 与首尾空白 → trim 后原串返回', () {
      expect(validateWebViewUrl('  HTTPS://A.B  '), 'HTTPS://A.B');
      expect(validateWebViewUrl('\tHttp://a.b\n'), 'Http://a.b');
    });

    test('相对串(无 scheme)→ null', () {
      expect(validateWebViewUrl('a.b/c'), isNull);
    });
  });
}
