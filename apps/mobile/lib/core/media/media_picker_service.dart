import 'dart:io';

import 'package:image_picker/image_picker.dart';

/// 选图结果(薄壳返回;path 为插件临时文件路径,sizeBytes 读取文件长度,width/height 可为 null)。
typedef PickedImage = ({String path, int? width, int? height, int sizeBytes});

/// 缺省最长边(pickImage maxWidth/maxHeight)。
const int kDefaultPickMaxDim = 2048;

/// 最长边上限。
const int kMaxPickDim = 4096;

/// 缺省压缩质量。
const int kDefaultPickQuality = 80;

/// 选图参数归一(纯函数):maxDim 缺省 2048、clamp [1,4096];quality 缺省 80、clamp [1,100]。
({int maxDim, int quality}) resolvePickParams({int? maxDim, int? quality}) {
  final int resolvedMaxDim =
      (maxDim ?? kDefaultPickMaxDim).clamp(1, kMaxPickDim);
  final int resolvedQuality = (quality ?? kDefaultPickQuality).clamp(1, 100);
  return (maxDim: resolvedMaxDim, quality: resolvedQuality);
}

/// 选图服务:image_picker 薄壳之上的抽象;用户取消一律返回 null,不抛异常。
abstract interface class MediaPickerService {
  /// 相册选一张;用户取消返回 null。
  Future<PickedImage?> pickFromGallery({int? maxDim, int? quality});

  /// 相机拍一张;用户取消返回 null。
  Future<PickedImage?> pickFromCamera({int? maxDim, int? quality});
}

/// image_picker 桥接(插件薄壳,单测不触):pickImage(imageQuality/maxWidth/maxHeight 换算:
/// maxWidth=maxHeight=maxDim.toDouble());取消(pickImage 返回 null)→ 返回 null;
/// sizeBytes 经 File(path).length();width/height 本类不读(交给 ImageInfoService),置 null。
class ImagePickerMediaPickerService implements MediaPickerService {
  ImagePickerMediaPickerService({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<PickedImage?> pickFromGallery({int? maxDim, int? quality}) =>
      _pick(ImageSource.gallery, maxDim: maxDim, quality: quality);

  @override
  Future<PickedImage?> pickFromCamera({int? maxDim, int? quality}) =>
      _pick(ImageSource.camera, maxDim: maxDim, quality: quality);

  Future<PickedImage?> _pick(
    ImageSource source, {
    int? maxDim,
    int? quality,
  }) async {
    final ({int maxDim, int quality}) params =
        resolvePickParams(maxDim: maxDim, quality: quality);
    final XFile? file = await _picker.pickImage(
      source: source,
      imageQuality: params.quality,
      maxWidth: params.maxDim.toDouble(),
      maxHeight: params.maxDim.toDouble(),
    );
    if (file == null) {
      return null;
    }
    final int sizeBytes = await File(file.path).length();
    return (path: file.path, width: null, height: null, sizeBytes: sizeBytes);
  }
}
