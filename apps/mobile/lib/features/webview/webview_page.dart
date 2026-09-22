import 'dart:convert';
import 'dart:io';

import 'package:cms_mobile/app_providers.dart';
import 'package:cms_mobile/core/hybrid/jsb_methods/device.dart';
import 'package:cms_mobile/core/hybrid/jsb_methods/media.dart';
import 'package:cms_mobile/core/hybrid/jsb_methods/page.dart';
import 'package:cms_mobile/core/hybrid/jsb_methods/ui.dart';
import 'package:cms_mobile/core/hybrid/jsb_registry.dart';
import 'package:cms_mobile/core/hybrid/webview_url.dart';
import 'package:cms_mobile/core/media/media_picker_service.dart';
import 'package:cms_mobile/core/permission/permission_rationale.dart';
import 'package:cms_mobile/core/permission/permission_service.dart';
import 'package:cms_mobile/core/ui/page_state.dart';
import 'package:cms_mobile/features/webview/webview_jsb_registry.dart';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// webview 容器页(卡 2.3):加载 H5 + JSB native 侧装配。
/// URL 合法性守卫在本页 build 内(路由层不做重定向)。
class WebViewPage extends ConsumerStatefulWidget {
  const WebViewPage({super.key, required this.url, this.title});

  /// 路由 query 原值,可能 null/非法。
  final String? url;

  /// 导航栏标题,可空(缺省 '网页')。
  final String? title;

  @override
  ConsumerState<WebViewPage> createState() => _WebViewPageState();
}

class _WebViewPageState extends ConsumerState<WebViewPage> {
  InAppWebViewController? _controller;
  double _progress = 0;
  bool _loadFailed = false;
  late String _pageTitle;
  bool _loadingVisible = false;
  late final JSBRegistry _registry;

  @override
  void initState() {
    super.initState();
    _pageTitle = _normalizeTitle(widget.title);
    _registry = buildWebViewJSBRegistry(
      device: JSBDeviceDependencies(
        config: ref.read(appConfigProvider),
        // 闭包注入:只在 JSB 调用时读取,initState 装配不触平台通道。
        readNetworkType: () =>
            ref.read(networkStatusServiceProvider).current.name,
      ),
      ui: JSBUIDependencies(
        showToast: _showToast,
        showLoading: _showLoading,
        hideLoading: _hideLoading,
        setNavigationBarTitle: _setNavigationBarTitle,
      ),
      page: JSBPageDependencies(
        // 导航语义:一律 push(保持 webview 在栈内,closePage 可返回);closePage 只出栈不 go。
        navigate: (location) {
          if (mounted) context.push(location);
        },
        canPop: () => mounted && GoRouter.of(context).canPop(),
        pop: () {
          if (mounted) context.pop();
        },
      ),
      media: JSBMediaDependencies(
        ensurePermission: (permission) async {
          final svc = ref.read(permissionServiceProvider);
          var state = await svc.check(permission);
          if (state == PermissionAppState.denied) {
            state = await svc.request(permission);
          }
          return state;
        },
        showPermissionDeniedHint: (permission, {required permanentlyDenied}) {
          if (!mounted) return;
          showPermissionRationaleDialog(
            context,
            permission: permission,
            permanentlyDenied: permanentlyDenied,
          );
        },
        pickFromGallery: ({required maxDim, required quality}) =>
            _pickAndCompress(
                (s) => s.pickFromGallery(maxDim: maxDim, quality: quality)),
        pickFromCamera: ({required maxDim, required quality}) =>
            _pickAndCompress(
                (s) => s.pickFromCamera(maxDim: maxDim, quality: quality)),
        saveToAlbum: (path) =>
            ref.read(mediaSaverServiceProvider).saveImageToAlbum(path),
        readImageInfo: (path) async {
          final info = await ref.read(imageInfoServiceProvider).read(path);
          return (
            path: info.path,
            width: info.width,
            height: info.height,
            sizeBytes: info.sizeBytes
          );
        },
        readFileBytes: (path) => File(path).readAsBytes(),
      ),
    );
  }

  static String _normalizeTitle(String? raw) {
    final String? trimmed = raw?.trim();
    return trimmed == null || trimmed.isEmpty ? '网页' : trimmed;
  }

  @override
  Widget build(BuildContext context) {
    final String? validUrl = validateWebViewUrl(widget.url);
    if (validUrl == null) {
      return Scaffold(
        appBar: AppBar(title: Text(_pageTitle)),
        body: const PageStateView(
          status: PageStatus.error,
          errorMessage: '链接无效或仅支持 http/https',
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(_pageTitle)),
      body: Column(
        children: [
          if (_progress < 1) LinearProgressIndicator(value: _progress),
          Expanded(
            child: Stack(
              children: [
                InAppWebView(
                  initialUrlRequest: URLRequest(url: WebUri(validUrl)),
                  initialSettings:
                      InAppWebViewSettings(javaScriptEnabled: true),
                  onWebViewCreated: (controller) {
                    _controller = controller;
                    controller.addJavaScriptHandler(
                      handlerName: kJSBHandlerName,
                      callback: (args) => _registry.handleRawCall(args),
                    );
                  },
                  onProgressChanged: (controller, progress) {
                    setState(() => _progress = progress / 100);
                  },
                  onLoadStop: (controller, url) {
                    _dispatchJSBEvent(
                      kWebViewReadyEvent,
                      <String, dynamic>{'url': url?.toString() ?? validUrl},
                    );
                  },
                  onReceivedError: (controller, request, error) {
                    if (request.isForMainFrame == true) {
                      setState(() => _loadFailed = true);
                    }
                  },
                ),
                if (_loadFailed)
                  Positioned.fill(
                    child: ColoredBox(
                      color: Theme.of(context).colorScheme.surface,
                      child: PageStateView(
                        status: PageStatus.error,
                        errorMessage: '页面加载失败',
                        onRetry: () {
                          setState(() => _loadFailed = false);
                          _controller?.reload();
                        },
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// native→js 事件派发:controller 未就绪时静默跳过。
  Future<void> _dispatchJSBEvent(String event, Object? payload) async {
    final String source =
        'window.$kWindowBridgeKey && window.$kWindowBridgeKey.dispatchEvent(${jsonEncode(event)}, ${jsonEncode(payload)});';
    await _controller?.evaluateJavascript(source: source);
  }

  /// 选图管线(JSB media 组注入):pick → 压缩(小文件自动跳过,见 shouldSkipCompress)
  /// → 读尺寸;取消返回 null。
  Future<JSBPickedImage?> _pickAndCompress(
    Future<PickedImage?> Function(MediaPickerService) pick,
  ) async {
    final picker = ref.read(mediaPickerServiceProvider);
    final picked = await pick(picker);
    if (picked == null) return null;
    final compressed =
        await ref.read(imageCompressServiceProvider).compress(picked.path);
    final info = await ref.read(imageInfoServiceProvider).read(compressed);
    return (
      path: info.path,
      width: info.width,
      height: info.height,
      sizeBytes: info.sizeBytes
    );
  }

  // ---- JSB ui 组注入实现(全部判 mounted:页面销毁后迟到的调用直接 no-op,不抛错) ----

  void _showToast(String message, {required bool long}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        duration: Duration(seconds: long ? 4 : 2),
      ),
    );
  }

  void _showLoading(String text) {
    if (!mounted || _loadingVisible) return;
    setState(() => _loadingVisible = true);
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => PopScope(
        canPop: false,
        child: Center(
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CircularProgressIndicator(),
                  const SizedBox(height: 12),
                  Text(text),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _hideLoading() {
    if (!mounted || !_loadingVisible) return;
    setState(() => _loadingVisible = false);
    Navigator.of(context, rootNavigator: true).pop();
  }

  void _setNavigationBarTitle(String title) {
    if (!mounted) return;
    setState(() => _pageTitle = title);
  }
}
