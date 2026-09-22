import 'package:file_picker/file_picker.dart';

/// 提取小写扩展名(纯函数):'a.PNG'→'png';无扩展名/以点结尾 → 空串;多点文件名取最后一段。
String fileExtensionOf(String fileName) {
  final int dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot == fileName.length - 1) {
    return '';
  }
  return fileName.substring(dot + 1).toLowerCase();
}

/// 文件白名单拒绝文案(中文锁定):类型不允许。
const String kFileExtensionRejectedMessage = '不支持的文件类型';

/// 文件白名单拒绝文案(中文锁定):超过大小限制。
const String kFileSizeExceededMessage = '文件超过大小限制';

/// 白名单拒绝原因(纯函数):null = 允许;否则返回对应中文文案。
/// allowedExtensions 为 null/空 = 不限类型(只校大小);扩展名比较统一小写、不带点;
/// maxSizeBytes ≤0 = 不限大小;超过才拒绝(恰好等于上限视为允许)。
String? fileRejectionMessage({
  required String fileName,
  required int sizeBytes,
  List<String>? allowedExtensions,
  int maxSizeBytes = 0,
}) {
  if (allowedExtensions != null && allowedExtensions.isNotEmpty) {
    final String extension = fileExtensionOf(fileName);
    final bool matched = allowedExtensions.any(
      (String allowed) => allowed.toLowerCase() == extension,
    );
    if (!matched) {
      return kFileExtensionRejectedMessage;
    }
  }
  if (maxSizeBytes > 0 && sizeBytes > maxSizeBytes) {
    return kFileSizeExceededMessage;
  }
  return null;
}

/// 文件白名单判定(纯函数):无拒绝原因即允许(见 fileRejectionMessage)。
bool isFileAllowed({
  required String fileName,
  required int sizeBytes,
  List<String>? allowedExtensions,
  int maxSizeBytes = 0,
}) =>
    fileRejectionMessage(
      fileName: fileName,
      sizeBytes: sizeBytes,
      allowedExtensions: allowedExtensions,
      maxSizeBytes: maxSizeBytes,
    ) ==
    null;

/// 选文件结果。
typedef PickedFileInfo = ({String path, String name, int sizeBytes});

/// 文件选择服务;白名单外类型/超限大小 → 抛 ArgumentError(中文文案);用户取消 → null。
abstract interface class FileService {
  /// 选单个文件;白名单外类型/超限大小 → 抛 ArgumentError(中文文案);用户取消 → null。
  Future<PickedFileInfo?> pick({
    List<String>? allowedExtensions,
    int maxSizeBytes = 0,
  });
}

/// file_picker 桥接(插件薄壳,单测经注入 fake FilePicker 直测拒绝语义):
/// FilePicker.pickFiles(type/allowedExtensions 换算:非空白名单 → FileType.custom)。
class FilePickerFileService implements FileService {
  FilePickerFileService({FilePicker? picker})
      : _picker = picker ?? FilePicker.platform;

  final FilePicker _picker;

  @override
  Future<PickedFileInfo?> pick({
    List<String>? allowedExtensions,
    int maxSizeBytes = 0,
  }) async {
    final bool unrestricted =
        allowedExtensions == null || allowedExtensions.isEmpty;
    final FilePickerResult? result = await _picker.pickFiles(
      type: unrestricted ? FileType.any : FileType.custom,
      allowedExtensions: unrestricted ? null : allowedExtensions,
    );
    if (result == null || result.files.isEmpty) {
      return null;
    }
    final PlatformFile file = result.files.first;
    final String? path = file.path;
    if (path == null) {
      throw StateError('file picker returned no path');
    }
    final String? rejection = fileRejectionMessage(
      fileName: file.name,
      sizeBytes: file.size,
      allowedExtensions: allowedExtensions,
      maxSizeBytes: maxSizeBytes,
    );
    if (rejection != null) {
      throw ArgumentError(rejection);
    }
    return (path: path, name: file.name, sizeBytes: file.size);
  }
}
