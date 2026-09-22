import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:cms_mobile/core/media/media_picker_service.dart';

import 'file_service.dart';

/// 图片类型推断(纯函数,按最后一段路径的扩展名、统一小写):jpg→jpeg;
/// png/gif/webp/heic 原样;未知扩展名/无扩展名 → 'unknown'。
String resolveImageType(String path) {
  final int slash = path.lastIndexOf('/');
  final String name = slash < 0 ? path : path.substring(slash + 1);
  final String extension = fileExtensionOf(name);
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'jpeg';
    case 'png':
      return 'png';
    case 'gif':
      return 'gif';
    case 'webp':
      return 'webp';
    case 'heic':
      return 'heic';
    default:
      return 'unknown';
  }
}

/// 图片信息读取服务:读取图片尺寸与大小;文件不存在/解码失败抛异常。
abstract interface class ImageInfoService {
  /// 读取图片尺寸与大小;文件不存在/解码失败抛异常。
  Future<PickedImage> read(String path);
}

/// dart:ui 解码薄壳(插件级薄壳,单测不触):
/// File.readAsBytes → dart:ui instantiateImageCodec → width/height;sizeBytes=字节长度。
class UiImageInfoService implements ImageInfoService {
  const UiImageInfoService();

  @override
  Future<PickedImage> read(String path) async {
    final Uint8List bytes = await File(path).readAsBytes();
    final ui.Codec codec = await ui.instantiateImageCodec(bytes);
    try {
      final ui.FrameInfo frame = await codec.getNextFrame();
      try {
        return (
          path: path,
          width: frame.image.width,
          height: frame.image.height,
          sizeBytes: bytes.length,
        );
      } finally {
        frame.image.dispose();
      }
    } finally {
      codec.dispose();
    }
  }
}
