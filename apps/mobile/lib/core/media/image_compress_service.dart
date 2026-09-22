import 'dart:io';

import 'package:flutter_image_compress/flutter_image_compress.dart';

import 'media_picker_service.dart';

/// 缺省压缩跳过阈值:源文件 ≤ 200KB 直接跳过(纯函数决策)。
const int kSkipCompressBelowBytes = 200 * 1024;

/// 是否跳过压缩(纯函数):体积 ≤ skipBelowBytes 跳过(缺省阈值 200*1024)。
bool shouldSkipCompress({
  required int sizeBytes,
  int skipBelowBytes = kSkipCompressBelowBytes,
}) =>
    sizeBytes <= skipBelowBytes;

/// 压缩产物路径(纯函数):与源文件同目录,命名 <原名>_compressed.jpg;
/// 无扩展名/以点结尾时直接追加 _compressed.jpg(取 base 段)。
String compressedTargetPathOf(String sourcePath) {
  final int slash = sourcePath.lastIndexOf('/');
  final String dir = slash < 0 ? '' : sourcePath.substring(0, slash + 1);
  final String name = slash < 0 ? sourcePath : sourcePath.substring(slash + 1);
  final int dot = name.lastIndexOf('.');
  final String base = dot <= 0 ? name : name.substring(0, dot);
  return '$dir${base}_compressed.jpg';
}

/// 图片压缩服务:flutter_image_compress 薄壳之上的抽象。
abstract interface class ImageCompressService {
  /// 压缩 [sourcePath] 到同目录新文件(命名 <原名>_compressed.jpg),返回新路径;
  /// 源文件已小于 skipBelowBytes 时直接返回原路径(纯函数决策,见 shouldSkipCompress)。
  Future<String> compress(String sourcePath, {int? maxDim, int? quality});
}

/// flutter_image_compress 桥接(插件薄壳,单测不触):
/// FlutterImageCompress.compressAndGetFile(minWidth/minHeight=maxDim, quality, jpeg);
/// 插件返回 null(失败)→ 抛 StateError('image compress failed')(调用方/JSB 层兜底归一)。
class FlutterImageCompressService implements ImageCompressService {
  const FlutterImageCompressService();

  @override
  Future<String> compress(
    String sourcePath, {
    int? maxDim,
    int? quality,
  }) async {
    if (shouldSkipCompress(sizeBytes: await File(sourcePath).length())) {
      return sourcePath;
    }
    final ({int maxDim, int quality}) params =
        resolvePickParams(maxDim: maxDim, quality: quality);
    final XFile? result = await FlutterImageCompress.compressAndGetFile(
      sourcePath,
      compressedTargetPathOf(sourcePath),
      minWidth: params.maxDim,
      minHeight: params.maxDim,
      quality: params.quality,
      format: CompressFormat.jpeg,
    );
    if (result == null) {
      throw StateError('image compress failed');
    }
    return result.path;
  }
}
