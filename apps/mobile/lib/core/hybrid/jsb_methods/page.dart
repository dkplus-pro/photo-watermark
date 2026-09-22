import '../jsb_registry.dart';
import '../webview_url.dart';

const List<String> pageJSBMethodNames = <String>['openPage', 'closePage'];

/// openPage 白名单 path 集合(native 侧兜底,H5 调试页生产可见的风险缓解,计划 §6)。
const Set<String> kOpenPageAllowedPaths = <String>{'/', '/webview'};

/// page 组依赖:导航能力由 webview 容器页经 GoRouter 注入。
class JSBPageDependencies {
  const JSBPageDependencies({
    required this.navigate,
    required this.canPop,
    required this.pop,
  });

  /// 跳转(实现方用 GoRouter push;入参为已拼好 query 的 location)。
  final void Function(String location) navigate;

  /// 当前页面可否出栈。
  final bool Function() canPop;

  /// 出栈(仅当 canPop 为 true 时调用方才调)。
  final void Function() pop;
}

/// openPage 参数校验 + location 拼装(纯函数,单测直测):
/// 合法返回 location 字符串;非法抛 JSBException(BAD_PARAMS)。
String resolveOpenPageLocation(Map<String, dynamic> params) {
  final Object? path = params['path'];
  if (path is! String || path.trim().isEmpty) {
    throw const JSBException(
        kJSBErrBadParams, 'openPage: "path" must be a non-empty string');
  }
  if (!kOpenPageAllowedPaths.contains(path)) {
    throw JSBException(
        kJSBErrBadParams, 'openPage: path "$path" is not in the whitelist');
  }
  if (path == '/') {
    return '/';
  }
  final Object? rawParams = params['params'];
  if (rawParams is! Map) {
    throw const JSBException(
        kJSBErrBadParams, 'openPage: "params.url" is required for "/webview"');
  }
  final Object? rawUrl = rawParams['url'];
  final String? url = rawUrl is String ? rawUrl : null;
  final String? validUrl = validateWebViewUrl(url);
  if (validUrl == null) {
    throw const JSBException(
        kJSBErrBadParams, 'openPage: "params.url" must be a valid http(s) url');
  }
  final Object? rawTitle = rawParams['title'];
  final String? title = rawTitle is String ? rawTitle : null;
  final String location = '/webview?url=${Uri.encodeQueryComponent(validUrl)}';
  return title == null
      ? location
      : '$location&title=${Uri.encodeQueryComponent(title)}';
}

/// page 组两 handler:openPage = resolve → navigate;closePage = canPop 才 pop。
Map<String, JSBHandler> buildPageHandlers(JSBPageDependencies deps) {
  return <String, JSBHandler>{
    'openPage': (params) async {
      deps.navigate(resolveOpenPageLocation(params));
      return null;
    },
    'closePage': (params) async {
      if (deps.canPop()) {
        deps.pop();
      }
      return null;
    },
  };
}
