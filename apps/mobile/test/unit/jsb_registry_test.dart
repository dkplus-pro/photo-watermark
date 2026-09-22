// JSBRegistry 单测(R 系列,方案 §6.1):handler 表/dispatch 信封/错误码映射/raw 解码。
// 纯 Dart 逻辑,flutter_test 仅提供 test/expect 断言。
import 'dart:convert';

import 'package:cms_mobile/core/hybrid/jsb_registry.dart';
import 'package:flutter_test/flutter_test.dart';

/// 提取信封 error 子对象。
Map<String, dynamic> _error(Map<String, dynamic> envelope) =>
    envelope['error'] as Map<String, dynamic>;

void main() {
  group('协议常量(与 packages/js-bridge 逐字对照,验收清单 4)', () {
    test('handler 名/window 键/成功码/数字码/错误码字符串', () {
      expect(kJSBHandlerName, 'jsb');
      expect(kWindowBridgeKey, '__JSB_BRIDGE__');
      expect(kJSBResultOk, 0);
      expect(kJSBCodeNativeError, 1000);
      expect(kJSBCodeMethodNotFound, 1001);
      expect(kJSBCodeBadParams, 1002);
      expect(kJSBCodeCancelled, 1003);
      expect(kJSBErrNativeError, 'NATIVE_ERROR');
      expect(kJSBErrMethodNotFound, 'METHOD_NOT_FOUND');
      expect(kJSBErrBadParams, 'BAD_PARAMS');
      expect(kJSBErrCancelled, 'CANCELLED');
    });
  });

  group('dispatch', () {
    test('R1 成功往返带 data', () async {
      final registry = JSBRegistry()
        ..register(
          'echo',
          (params) async => <String, dynamic>{'ok': true},
        );

      final envelope = await registry.dispatch('echo', <String, dynamic>{});

      expect(envelope, <String, dynamic>{
        'code': 0,
        'data': <String, dynamic>{'ok': true},
      });
    });

    test('R2 未注册 method → METHOD_NOT_FOUND 信封,message 含 method 名', () async {
      final envelope = await JSBRegistry().dispatch('nope', const {});

      expect(envelope['code'], 1001);
      expect(_error(envelope)['code'], 'METHOD_NOT_FOUND');
      expect(_error(envelope)['message'],
          'no handler registered for method "nope"');
      expect(_error(envelope)['message'], contains('nope'));
    });

    test('R3 handler 返回 null(零值)→ 信封无 data 键', () async {
      final registry = JSBRegistry()
        ..register(
          'null-data',
          (params) => Future<Map<String, dynamic>?>.value(),
        );

      final envelope = await registry.dispatch('null-data', const {});

      expect(envelope, <String, dynamic>{'code': 0});
      expect(envelope.containsKey('data'), isFalse);
    });

    test('R4 JSBException 已知码 → 数字码与 error.code 按映射表', () async {
      final registry = JSBRegistry()
        ..register(
          'boom-params',
          (params) async => throw const JSBException(kJSBErrBadParams, 'x'),
        );

      final envelope = await registry.dispatch('boom-params', const {});

      expect(envelope['code'], 1002);
      expect(_error(envelope)['code'], 'BAD_PARAMS');
      expect(_error(envelope)['message'], 'x');
    });

    test('R5 JSBException 未知码 → 数字码 1000,error.code 保留原字符串', () async {
      final registry = JSBRegistry()
        ..register(
          'denied',
          (params) async =>
              throw const JSBException('PERMISSION_DENIED', 'deny'),
        );

      final envelope = await registry.dispatch('denied', const {});

      expect(envelope['code'], 1000);
      expect(_error(envelope)['code'], 'PERMISSION_DENIED');
      expect(_error(envelope)['message'], 'deny');
    });

    test('R6 非 JSBException 兜底 → NATIVE_ERROR,message 为 e.toString()',
        () async {
      final registry = JSBRegistry()
        ..register(
          'crash',
          (params) async => throw StateError('boom'),
        );

      final envelope = await registry.dispatch('crash', const {});

      expect(envelope['code'], 1000);
      expect(_error(envelope)['code'], 'NATIVE_ERROR');
      expect(_error(envelope)['message'], contains('boom'));
    });

    test('R7 同步 throw 与无 await 的返回值均归一(Future.sync 形态)', () async {
      final registry = JSBRegistry()
        // 闭包体无 await:值同步构造,Future 立即完成(dispatch 侧同为 await 路径)。
        ..register('sync-ok', (params) async => <String, dynamic>{'a': 1})
        // 真正的同步 throw(非 Future 失败):由 dispatch 的 Future.sync 捕获。
        ..register(
          'sync-throw',
          (params) => throw StateError('sync'),
        );

      final ok = await registry.dispatch('sync-ok', const {});
      expect(ok, <String, dynamic>{
        'code': 0,
        'data': <String, dynamic>{'a': 1},
      });

      // 不向上抛,归一为信封。
      final failed = await registry.dispatch('sync-throw', const {});
      expect(failed['code'], 1000);
      expect(_error(failed)['code'], 'NATIVE_ERROR');
    });

    test('R17 handler 异步失败(Future.error)→ dispatch 不抛,归一信封', () async {
      final registry = JSBRegistry()
        ..register(
          'async-fail',
          (params) =>
              Future<Map<String, dynamic>?>.error(StateError('async-fail')),
        );

      final envelope = await registry.dispatch('async-fail', const {});

      expect(envelope['code'], 1000);
      expect(_error(envelope)['code'], 'NATIVE_ERROR');
      expect(_error(envelope)['message'], contains('async-fail'));
    });
  });

  group('handleRawCall', () {
    test('R8 空 args(空值)→ BAD_PARAMS', () async {
      final envelope = await JSBRegistry().handleRawCall(<dynamic>[]);

      expect(envelope['code'], 1002);
      expect(_error(envelope)['message'], 'missing request argument');
    });

    test('R9 args[0] 为 JSON 字符串 → 解码后正常分发,params 缺省为空 Map', () async {
      Map<String, dynamic>? received;
      final registry = JSBRegistry()
        ..register(
          'm',
          (params) async {
            received = params;
            return <String, dynamic>{'done': true};
          },
        );

      final envelope = await registry.handleRawCall(
        <dynamic>[
          jsonEncode(<String, dynamic>{'method': 'm'})
        ],
      );

      expect(envelope['code'], 0);
      expect(envelope['data'], <String, dynamic>{'done': true});
      expect(received, <String, dynamic>{});
    });

    test('R10 args[0] 非 JSON 字符串 → BAD_PARAMS', () async {
      final envelope = await JSBRegistry().handleRawCall(<dynamic>['not-json']);

      expect(envelope['code'], 1002);
      expect(_error(envelope)['message'], 'request is not valid JSON');
    });

    test('R11 args[0] 非法类型(数字/数组)→ BAD_PARAMS', () async {
      for (final arg in <dynamic>[
        42,
        <dynamic>['x']
      ]) {
        final envelope = await JSBRegistry().handleRawCall(<dynamic>[arg]);

        expect(envelope['code'], 1002);
        expect(_error(envelope)['message'], 'request is not an object');
      }
    });

    test('R12 method 缺失/空串/纯空白 → BAD_PARAMS', () async {
      final requests = <dynamic>[
        <String, dynamic>{'id': '1'},
        <String, dynamic>{'method': ''},
        <String, dynamic>{'method': '  '},
      ];
      for (final request in requests) {
        final envelope = await JSBRegistry().handleRawCall(<dynamic>[request]);

        expect(envelope['code'], 1002);
        expect(
          _error(envelope)['message'],
          'request "method" must be a non-empty string',
        );
      }
    });

    test('R13 params 非对象 → BAD_PARAMS', () async {
      final envelope = await JSBRegistry().handleRawCall(<dynamic>[
        <String, dynamic>{'method': 'm', 'params': 3},
      ]);

      expect(envelope['code'], 1002);
      expect(_error(envelope)['message'], 'request "params" must be an object');
    });

    test('R14 params 缺省 → handler 收到空 Map', () async {
      Map<String, dynamic>? received;
      final registry = JSBRegistry()
        ..register(
          'm',
          (params) async {
            received = params;
            return null;
          },
        );

      final envelope = await registry.handleRawCall(<dynamic>[
        <String, dynamic>{'method': 'm'},
      ]);

      expect(envelope, <String, dynamic>{'code': 0});
      expect(received, isNotNull);
      expect(received, isEmpty);
    });

    test('R9b 请求 id 不回传信封(留痕但不在应答中)', () async {
      final registry = JSBRegistry()
        ..register('m', (params) async => <String, dynamic>{'a': 1});

      final envelope = await registry.handleRawCall(<dynamic>[
        <String, dynamic>{'id': 'call-1', 'method': 'm'},
      ]);

      expect(envelope.containsKey('id'), isFalse);
    });
  });

  group('register / registerAll', () {
    Future<Map<String, dynamic>?> noop(Map<String, dynamic> params) async =>
        null;

    test('R15 重复注册 → 第二次抛 ArgumentError;registerAll 与已注册表重复同样抛', () async {
      final registry = JSBRegistry()..register('dup', noop);

      expect(
        () => registry.register('dup', noop),
        throwsArgumentError,
      );
      expect(
        // Dart Map 字面量本身不允许重复键,「表内重复」经跨表(与已注册 method 冲突)暴露。
        () => registry.registerAll(<String, JSBHandler>{'dup': noop}),
        throwsArgumentError,
      );
    });

    test('R16 空 method 注册 → ArgumentError', () {
      final registry = JSBRegistry();

      expect(() => registry.register('', noop), throwsArgumentError);
      expect(() => registry.register('   ', noop), throwsArgumentError);
    });

    test('registerAll 批量注册成功后 methodCount/hasMethod 正确', () {
      final registry = JSBRegistry()
        ..registerAll(<String, JSBHandler>{'a': noop, 'b': noop});

      expect(registry.methodCount, 2);
      expect(registry.hasMethod('a'), isTrue);
      expect(registry.hasMethod('b'), isTrue);
      expect(registry.hasMethod('c'), isFalse);
    });
  });
}
