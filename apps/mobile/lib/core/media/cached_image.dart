import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

/// 可加载网络图判定(纯函数):非空且 http/https 前缀(scheme 大小写不敏感);
/// 空/非法返回 false(渲染 errorWidget 分支,不发起请求)。
bool isLoadableImageUrl(String? url) {
  if (url == null || url.isEmpty) {
    return false;
  }
  final String lower = url.toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://');
}

/// 通用缓存网络图:加载进度 + 失败占位;业务不直接 import cached_network_image。
class CachedAppImage extends StatelessWidget {
  const CachedAppImage({
    super.key,
    required this.url,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.memCacheWidth,
  });

  /// 图片地址;空/非法(非 http(s))时渲染错误占位,不发起请求。
  final String url;

  final double? width;
  final double? height;
  final BoxFit fit;
  final int? memCacheWidth;

  Widget _errorPlaceholder(BuildContext context) => ColoredBox(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        child: const Center(
          child: Icon(Icons.broken_image_outlined),
        ),
      );

  @override
  Widget build(BuildContext context) {
    if (!isLoadableImageUrl(url)) {
      return _errorPlaceholder(context);
    }
    return CachedNetworkImage(
      imageUrl: url,
      width: width,
      height: height,
      fit: fit,
      memCacheWidth: memCacheWidth,
      placeholder: (_, __) => const Center(child: CircularProgressIndicator()),
      errorWidget: (_, __, ___) => _errorPlaceholder(context),
    );
  }
}
