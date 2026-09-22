import '../jsb_registry.dart';

const List<String> uiJSBMethodNames = <String>[
  'showToast',
  'showLoading',
  'hideLoading',
  'setNavigationBarTitle',
];

/// showLoading 缺省文案(text 缺省/非法时回退)。
const String kDefaultLoadingText = '加载中…';

/// setNavigationBarTitle 最大长度(trim 后)。
const int kMaxNavigationBarTitleLength = 64;

/// UI 组依赖:每页(webview 容器)持自己的 BuildContext 实现并注入。
class JSBUIDependencies {
  const JSBUIDependencies({
    required this.showToast,
    required this.showLoading,
    required this.hideLoading,
    required this.setNavigationBarTitle,
  });

  /// 展示 toast;long=false 短吐司(2s)/true 长吐司(4s)。
  final void Function(String message, {required bool long}) showToast;

  /// 展示加载遮罩(幂等:重复调用保持单个实例;text 为展示文案)。
  final void Function(String text) showLoading;

  /// 关闭加载遮罩(无实例时 no-op)。
  final void Function() hideLoading;

  /// 设置当前容器页原生导航栏标题。
  final void Function(String title) setNavigationBarTitle;
}

/// UI 组四 handler:本文件只做参数校验与调用编排,不 import flutter。
/// 校验失败一律抛 JSBException(BAD_PARAMS),由 registry 归一为 BAD_PARAMS 信封。
Map<String, JSBHandler> buildUIHandlers(JSBUIDependencies deps) {
  return <String, JSBHandler>{
    'showToast': (params) async {
      final Object? message = params['message'];
      if (message is! String || message.trim().isEmpty) {
        throw const JSBException(kJSBErrBadParams,
            'showToast: "message" must be a non-empty string');
      }
      final Object? duration = params['duration'];
      if (duration != null && duration != 'short' && duration != 'long') {
        throw const JSBException(kJSBErrBadParams,
            'showToast: "duration" must be "short" or "long"');
      }
      deps.showToast(message, long: duration == 'long');
      return null;
    },
    'showLoading': (params) async {
      final Object? text = params['text'];
      deps.showLoading(text is String ? text : kDefaultLoadingText);
      return null;
    },
    'hideLoading': (params) async {
      deps.hideLoading();
      return null;
    },
    'setNavigationBarTitle': (params) async {
      final Object? title = params['title'];
      if (title is! String || title.trim().isEmpty) {
        throw const JSBException(kJSBErrBadParams,
            'setNavigationBarTitle: "title" must be a non-empty string');
      }
      final String trimmed = title.trim();
      if (trimmed.length > kMaxNavigationBarTitleLength) {
        throw const JSBException(kJSBErrBadParams,
            'setNavigationBarTitle: "title" is too long (max 64)');
      }
      deps.setNavigationBarTitle(trimmed);
      return null;
    },
  };
}
