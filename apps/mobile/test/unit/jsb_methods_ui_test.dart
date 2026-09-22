// ui 组 JSB 方法单测(U 系列,方案 §6.3):spy 依赖记录调用参数,不引 mock 框架。
import 'package:cms_mobile/core/hybrid/jsb_methods/ui.dart';
import 'package:cms_mobile/core/hybrid/jsb_registry.dart';
import 'package:flutter_test/flutter_test.dart';

/// 记录调用参数的简单 spy。
class _UISpy {
  final List<(String message, bool long)> toasts = <(String, bool)>[];
  final List<String> loadings = <String>[];
  final List<String> titles = <String>[];
  int hideCalls = 0;

  JSBUIDependencies deps() => JSBUIDependencies(
        showToast: (message, {required long}) => toasts.add((message, long)),
        showLoading: (text) => loadings.add(text),
        hideLoading: () => hideCalls++,
        setNavigationBarTitle: (title) => titles.add(title),
      );
}

Matcher _badParams(String message) => isA<JSBException>()
    .having((e) => e.code, 'code', kJSBErrBadParams)
    .having((e) => e.message, 'message', message);

void main() {
  late _UISpy spy;
  late Map<String, JSBHandler> handlers;

  setUp(() {
    spy = _UISpy();
    handlers = buildUIHandlers(spy.deps());
  });

  test('U1 showToast message 缺失/空串/纯空白 → BAD_PARAMS,spy 未被调', () async {
    final cases = <Map<String, dynamic>>[
      const {},
      const {'message': ''},
      const {'message': '   '},
    ];
    for (final params in cases) {
      await expectLater(
        handlers['showToast']!(params),
        throwsA(_badParams('showToast: "message" must be a non-empty string')),
      );
    }
    expect(spy.toasts, isEmpty);
  });

  test('U2 duration 非法 → BAD_PARAMS;缺省与 short → long=false;long → long=true',
      () async {
    for (final bad in <Object?>['medium', 3]) {
      await expectLater(
        handlers['showToast']!(<String, dynamic>{
          'message': 'hi',
          'duration': bad,
        }),
        throwsA(
          _badParams('showToast: "duration" must be "short" or "long"'),
        ),
      );
    }
    expect(spy.toasts, isEmpty);

    await handlers['showToast']!(const {'message': 'hi'});
    expect(spy.toasts.single, ('hi', false));

    await handlers['showToast']!(const {'message': 'hi', 'duration': 'short'});
    expect(spy.toasts.last, ('hi', false));

    await handlers['showToast']!(const {'message': 'hi', 'duration': 'long'});
    expect(spy.toasts.last, ('hi', true));
  });

  test('U3 showLoading 无 text/非 string text 回退默认文案,合法 text 透传', () async {
    await handlers['showLoading']!(const {});
    expect(spy.loadings.single, '加载中…');

    await handlers['showLoading']!(const {'text': '稍等'});
    expect(spy.loadings.last, '稍等');

    await handlers['showLoading']!(const {'text': 3});
    expect(spy.loadings.last, '加载中…');
  });

  test('U4 hideLoading 连续两次调用均成功返回 null(spy 被调两次)', () async {
    expect(await handlers['hideLoading']!(const {}), isNull);
    expect(await handlers['hideLoading']!(const {}), isNull);
    expect(spy.hideCalls, 2);
  });

  test('U5 title 缺失/空串/纯空白 → BAD_PARAMS,spy 未被调', () async {
    final cases = <Map<String, dynamic>>[
      const {},
      const {'title': ''},
      const {'title': '   '},
    ];
    for (final params in cases) {
      await expectLater(
        handlers['setNavigationBarTitle']!(params),
        throwsA(_badParams(
            'setNavigationBarTitle: "title" must be a non-empty string')),
      );
    }
    expect(spy.titles, isEmpty);
  });

  test('U6 title 65 字符 → BAD_PARAMS;64 字符 → 成功;带空白 → trim 后透传', () async {
    await expectLater(
      handlers['setNavigationBarTitle']!(
        {'title': 'a' * 65},
      ),
      throwsA(
          _badParams('setNavigationBarTitle: "title" is too long (max 64)')),
    );
    expect(spy.titles, isEmpty);

    await handlers['setNavigationBarTitle']!({'title': 'a' * 64});
    expect(spy.titles.single, 'a' * 64);

    await handlers['setNavigationBarTitle']!(const {'title': '  标题  '});
    expect(spy.titles.last, '标题');
  });

  test('U7 四方法成功均返回 null(信封将无 data 键)', () async {
    expect(
      await handlers['showToast']!(const {'message': 'hi'}),
      isNull,
    );
    expect(await handlers['showLoading']!(const {}), isNull);
    expect(await handlers['hideLoading']!(const {}), isNull);
    expect(
      await handlers['setNavigationBarTitle']!(const {'title': '标题'}),
      isNull,
    );
  });
}
