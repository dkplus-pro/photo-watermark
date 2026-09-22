import 'package:gal/gal.dart';

/// 相册保存服务;失败抛异常(由调用方兜底)。
abstract interface class MediaSaverService {
  /// 把 [path] 图片存入系统相册;失败抛异常(由调用方兜底)。
  Future<void> saveImageToAlbum(String path);
}

/// gal 桥接(插件薄壳,单测不触):Gal.putImage(path)。
class GalMediaSaverService implements MediaSaverService {
  const GalMediaSaverService();

  @override
  Future<void> saveImageToAlbum(String path) => Gal.putImage(path);
}
