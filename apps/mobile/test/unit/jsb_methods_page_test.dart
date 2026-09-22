// page 组 JSB 方法单测(P 系列,方案 §6.4):openPage 白名单/拼装 + closePage 出栈语义。
import 'package:cms_mobile/core/hybrid/jsb_methods/page.dart';
import 'package:cms_mobile/core/hybrid/jsb_registry.dart';
import 'package:flutter_test/flutter_test.dart';

/// 记录导航调用的 spy。
class _PageSpy {
  final List<String> navigations = <String>[];
  int popCalls = 0;
  bool canPop = false;

  JSBPageDependencies deps() => JSBPageDependencies(
        navigate: navigations.add,
        canPop: () => canPop,
        pop: () => popCalls++,
      );
}

Matcher _badParams(String? message) {
  final matcher =
      isA<JSBException>().having((e) => e.code, 'code', kJSBErrBadParams);
  return message == null
      ? matcher
      : matcher.having((e) => e.message, 'message', message);
}

void main() {
  test('P9 method 名清单与白名单常量', () {
    expect(pageJSBMethodNames, <String>['openPage', 'closePage']);
    expect(kOpenPageAllowedPaths, <String>{'/', '/webview'});
  });

  group('resolveOpenPageLocation', () {
    test('P1 path 缺失/纯空白 → BAD_PARAMS', () {
      expect(() => resolveOpenPageLocation(const {}),
          throwsA(_badParams('openPage: "path" must be a non-empty string')));
      expect(() => resolveOpenPageLocation(const {'path': '  '}),
          throwsA(_badParams(null)));
    });

    test('P2 白名单外 path → BAD_PARAMS 且 message 含 path', () {
      expect(
        () => resolveOpenPageLocation(const {'path': '/admin'}),
        throwsA(_badParams('openPage: path "/admin" is not in the whitelist')),
      );
      expect(
        () => resolveOpenPageLocation(const {'path': '/admin'}),
        throwsA(isA<JSBException>().having(
          (e) => e.message,
          'message',
          contains('/admin'),
        )),
      );
    });

    test('P3 根路径 → 返回 /,params 键忽略', () {
      expect(resolveOpenPageLocation(const {'path': '/'}), '/');
      expect(
        resolveOpenPageLocation(const {
          'path': '/',
          'params': {'junk': 1}
        }),
        '/',
      );
    });

    test('P4 /webview 缺 params 或 params 非 Map → BAD_PARAMS', () {
      expect(
        () => resolveOpenPageLocation(const {'path': '/webview'}),
        throwsA(
          _badParams('openPage: "params.url" is required for "/webview"'),
        ),
      );
      expect(
        () => resolveOpenPageLocation(
          const {'path': '/webview', 'params': 'not-a-map'},
        ),
        throwsA(_badParams(null)),
      );
    });

    test('P5 /webview url 非法(非 http(s))→ BAD_PARAMS', () {
      expect(
        () => resolveOpenPageLocation(
          const {
            'path': '/webview',
            'params': {'url': 'ftp://x'}
          },
        ),
        throwsA(
            _badParams('openPage: "params.url" must be a valid http(s) url')),
      );
    });

    test('P6 /webview 合法:拼 url(有 title 追加 &title,无 title 不追加)', () {
      expect(
        resolveOpenPageLocation(const {
          'path': '/webview',
          'params': {'url': 'https://a.b/c?d=1', 'title': '示例'},
        }),
        '/webview?url=${Uri.encodeQueryComponent('https://a.b/c?d=1')}'
        '&title=${Uri.encodeQueryComponent('示例')}',
      );
      expect(
        resolveOpenPageLocation(const {
          'path': '/webview',
          'params': {'url': 'https://a.b/c?d=1'},
        }),
        '/webview?url=${Uri.encodeQueryComponent('https://a.b/c?d=1')}',
      );
    });

    test('P6b title 非 string 时忽略', () {
      expect(
        resolveOpenPageLocation(const {
          'path': '/webview',
          'params': {'url': 'https://a.b', 'title': 3},
        }),
        '/webview?url=${Uri.encodeQueryComponent('https://a.b')}',
      );
    });
  });

  group('buildPageHandlers', () {
    test('P7 closePage:canPop=true → pop 一次;canPop=false → no-op 且返回 null',
        () async {
      final spy = _PageSpy()..canPop = true;
      final handlers = buildPageHandlers(spy.deps());

      expect(await handlers['closePage']!(const {}), isNull);
      expect(spy.popCalls, 1);

      final blocked = _PageSpy()..canPop = false;
      final blockedHandlers = buildPageHandlers(blocked.deps());
      expect(await blockedHandlers['closePage']!(const {}), isNull);
      expect(blocked.popCalls, 0);
    });

    test('P8 openPage:合法入参 → navigate 收到 location;非法入参 → navigate 未被调',
        () async {
      final spy = _PageSpy();
      final handlers = buildPageHandlers(spy.deps());

      await handlers['openPage']!(const {'path': '/'});
      expect(spy.navigations, <String>['/']);

      await handlers['openPage']!(const {
        'path': '/webview',
        'params': {'url': 'https://a.b'},
      });
      expect(
        spy.navigations.last,
        startsWith('/webview?url='),
      );

      await expectLater(
        handlers['openPage']!(const {'path': '/admin'}),
        throwsA(_badParams(null)),
      );
      expect(spy.navigations, hasLength(2));
    });
  });
}
