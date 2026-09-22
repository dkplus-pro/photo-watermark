import 'dart:async';
import 'dart:convert';

/// JSB handler 名(与 packages/js-bridge adapter.ts JSB_HANDLER_NAME 逐字一致)。
const String kJSBHandlerName = 'jsb';

/// window 注入键(与 packages/js-bridge global.ts WINDOW_BRIDGE_KEY 逐字一致)。
const String kWindowBridgeKey = '__JSB_BRIDGE__';

/// 成功码(与 JSB_RESULT_OK 一致)。
const int kJSBResultOk = 0;

/// 失败数字码(与 JS 侧 mapNativeFailure/阶段 1 测试 C3 约定一致)。
const int kJSBCodeNativeError = 1000;
const int kJSBCodeMethodNotFound = 1001;
const int kJSBCodeBadParams = 1002;
const int kJSBCodeCancelled = 1003;

/// 错误码字符串(protocol.ts JSB_ERROR_CODES 子集:native 只产生这 4 个)。
const String kJSBErrNativeError = 'NATIVE_ERROR';
const String kJSBErrMethodNotFound = 'METHOD_NOT_FOUND';
const String kJSBErrBadParams = 'BAD_PARAMS';
const String kJSBErrCancelled = 'CANCELLED';

/// handler 侧抛出的业务错误:code 为上表字符串,message 为人话。
class JSBException implements Exception {
  const JSBException(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => 'JSBException($code, $message)';
}

/// JSB handler:接收已解码的 params 对象(无 params 时为空 Map),返回 data 载荷。
/// 返回 null = 应答不携带 data 键。失败一律抛 JSBException(参数错)或任意异常(兜底 NATIVE_ERROR)。
typedef JSBHandler = Future<Map<String, dynamic>?> Function(
    Map<String, dynamic> params);

/// JSB native 注册表:method → handler;dispatch 输出协议信封(Map)。
class JSBRegistry {
  JSBRegistry();

  final Map<String, JSBHandler> _handlers = <String, JSBHandler>{};

  /// 注册单个 handler;重复注册同 method 抛 ArgumentError(非法状态护栏)。
  void register(String method, JSBHandler handler) {
    if (method.trim().isEmpty) {
      throw ArgumentError('JSB method must be a non-empty string');
    }
    if (_handlers.containsKey(method)) {
      throw ArgumentError('JSB method "$method" is already registered');
    }
    _handlers[method] = handler;
  }

  /// 批量注册;任一重复(表内或跨表)抛 ArgumentError。
  void registerAll(Map<String, JSBHandler> handlers) {
    handlers.forEach(register);
  }

  bool hasMethod(String method) => _handlers.containsKey(method);

  /// 已注册 method 数(装配断言用)。
  int get methodCount => _handlers.length;

  /// 按 method 分发,返回协议信封 Map(成功 {code:0,data?},失败 {code,error:{code,message}})。
  /// 永不抛异常(所有失败归一为信封)。
  Future<Map<String, dynamic>> dispatch(
      String method, Map<String, dynamic> params) async {
    final JSBHandler? handler = _handlers[method];
    if (handler == null) {
      return _failureEnvelope(JSBException(
        kJSBErrMethodNotFound,
        'no handler registered for method "$method"',
      ));
    }
    try {
      // Future.sync:同步返回值/同步 throw 与异步失败统一走同一条归一路径。
      final Map<String, dynamic>? data =
          await Future.sync(() => handler(params));
      if (data == null) {
        return <String, dynamic>{'code': kJSBResultOk};
      }
      return <String, dynamic>{'code': kJSBResultOk, 'data': data};
    } on JSBException catch (e) {
      return _failureEnvelope(e);
    } catch (e) {
      return _failureEnvelope(
        JSBException(kJSBErrNativeError, e.toString()),
      );
    }
  }

  /// flutter_inappwebview addJavaScriptHandler 的 callback 入口:解码 args[0] → dispatch → 信封。
  /// 永不抛异常(解码失败/形态非法归一 BAD_PARAMS 信封)。
  Future<Map<String, dynamic>> handleRawCall(List<dynamic> args) async {
    final ({String method, Map<String, dynamic> params}) request;
    try {
      request = _decodeRequest(args);
    } on JSBException catch (e) {
      return _failureEnvelope(e);
    }
    return dispatch(request.method, request.params);
  }

  /// 请求对象解码与校验:args[0] 为 Map 或 JSON 字符串(JS 侧透传两形态都可能)。
  ({String method, Map<String, dynamic> params}) _decodeRequest(
      List<dynamic> args) {
    if (args.isEmpty) {
      throw const JSBException(kJSBErrBadParams, 'missing request argument');
    }
    Object? decoded = args[0];
    if (decoded is String) {
      try {
        decoded = jsonDecode(decoded);
      } catch (_) {
        throw const JSBException(kJSBErrBadParams, 'request is not valid JSON');
      }
    }
    if (decoded is! Map) {
      throw const JSBException(kJSBErrBadParams, 'request is not an object');
    }
    final Map<String, dynamic> request;
    try {
      request = Map<String, dynamic>.from(decoded);
    } catch (_) {
      throw const JSBException(kJSBErrBadParams, 'request is not an object');
    }
    final Object? method = request['method'];
    if (method is! String || method.trim().isEmpty) {
      throw const JSBException(
          kJSBErrBadParams, 'request "method" must be a non-empty string');
    }
    final Object? rawParams = request['params'];
    if (rawParams == null) {
      return (method: method, params: const <String, dynamic>{});
    }
    if (rawParams is! Map) {
      throw const JSBException(
          kJSBErrBadParams, 'request "params" must be an object');
    }
    final Map<String, dynamic> params;
    try {
      params = Map<String, dynamic>.from(rawParams);
    } catch (_) {
      throw const JSBException(
          kJSBErrBadParams, 'request "params" must be an object');
    }
    return (method: method, params: params);
  }

  /// 失败信封:数字码按错误码字符串映射;未知字符串码数字码兜底 NATIVE_ERROR。
  Map<String, dynamic> _failureEnvelope(JSBException e) => <String, dynamic>{
        'code': _numericCodeFor(e.code),
        'error': <String, dynamic>{'code': e.code, 'message': e.message},
      };

  static int _numericCodeFor(String code) {
    switch (code) {
      case kJSBErrNativeError:
        return kJSBCodeNativeError;
      case kJSBErrMethodNotFound:
        return kJSBCodeMethodNotFound;
      case kJSBErrBadParams:
        return kJSBCodeBadParams;
      case kJSBErrCancelled:
        return kJSBCodeCancelled;
      default:
        return kJSBCodeNativeError;
    }
  }
}
