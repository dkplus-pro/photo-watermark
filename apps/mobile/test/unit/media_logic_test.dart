// core/media 纯逻辑单测(M 系列,阶段 6 方案 §4.2.9):压缩参数/跳过决策/文件白名单/图片类型/可加载 URL。
// M10 经注入 fake FilePicker 直测白名单拒绝文案(插件薄壳不出网络/系统对话框)。
import 'package:cms_mobile/core/media/cached_image.dart';
import 'package:cms_mobile/core/media/file_service.dart';
import 'package:cms_mobile/core/media/image_compress_service.dart';
import 'package:cms_mobile/core/media/image_info_service.dart';
import 'package:cms_mobile/core/media/media_picker_service.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_test/flutter_test.dart';

/// fake FilePicker:返回固定结果并记录入参(不触平台对话框)。
class _FakeFilePicker extends FilePicker {
  _FakeFilePicker(this.result);

  final FilePickerResult? result;
  List<String>? lastAllowedExtensions;
  FileType lastType = FileType.any;

  @override
  Future<FilePickerResult?> pickFiles({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    Function(FilePickerStatus)? onFileLoading,
    bool allowCompression = false,
    int compressionQuality = 0,
    bool allowMultiple = false,
    bool withData = false,
    bool withReadStream = false,
    bool lockParentWindow = false,
    bool readSequential = false,
  }) async {
    lastType = type;
    lastAllowedExtensions = allowedExtensions;
    return result;
  }
}

void main() {
  group('resolvePickParams', () {
    test('M1 全 null → 默认 (2048, 80)', () {
      final params = resolvePickParams();
      expect(params.maxDim, 2048);
      expect(params.quality, 80);
    });

    test('M2 maxDim/quality 越界 → clamp [1,4096] / [1,100]', () {
      expect(resolvePickParams(maxDim: 0).maxDim, 1);
      expect(resolvePickParams(maxDim: -5).maxDim, 1);
      expect(resolvePickParams(maxDim: 99999).maxDim, 4096);
      expect(resolvePickParams(maxDim: 4096).maxDim, 4096);
      expect(resolvePickParams(quality: -1).quality, 1);
      expect(resolvePickParams(quality: 0).quality, 1);
      expect(resolvePickParams(quality: 101).quality, 100);
      expect(resolvePickParams(quality: 100).quality, 100);
    });
  });

  test('M3 shouldSkipCompress:恰好等于阈值/阈值-1 → true;阈值+1 → false', () {
    const int threshold = 200 * 1024;
    expect(shouldSkipCompress(sizeBytes: threshold), isTrue);
    expect(shouldSkipCompress(sizeBytes: threshold - 1), isTrue);
    expect(shouldSkipCompress(sizeBytes: threshold + 1), isFalse);
  });

  test('M4 isFileAllowed 不限类型不限大小 → 恒 true', () {
    expect(
      isFileAllowed(fileName: 'anything.bin', sizeBytes: 999999999),
      isTrue,
    );
    expect(
      isFileAllowed(
        fileName: 'anything.bin',
        sizeBytes: 999999999,
        allowedExtensions: const <String>[],
      ),
      isTrue,
    );
  });

  test('M5 isFileAllowed 扩展名大小写不敏感;不在白名单 → false', () {
    expect(
      isFileAllowed(
        fileName: 'A.PNG',
        sizeBytes: 1,
        allowedExtensions: const ['png'],
      ),
      isTrue,
    );
    expect(
      isFileAllowed(
        fileName: 'photo.GIF',
        sizeBytes: 1,
        allowedExtensions: const ['png'],
      ),
      isFalse,
    );
  });

  test('M6 isFileAllowed 大小边界:恰好等于上限 → true;上限+1 → false', () {
    expect(
      isFileAllowed(
        fileName: 'a.png',
        sizeBytes: 1024,
        maxSizeBytes: 1024,
      ),
      isTrue,
    );
    expect(
      isFileAllowed(
        fileName: 'a.png',
        sizeBytes: 1025,
        maxSizeBytes: 1024,
      ),
      isFalse,
    );
  });

  test('M7 fileExtensionOf:无扩展名/以点结尾 → 空串;多点文件名取最后一段', () {
    expect(fileExtensionOf('noext'), '');
    expect(fileExtensionOf('dot.'), '');
    expect(fileExtensionOf('a.tar.gz'), 'gz');
    expect(fileExtensionOf('a.PNG'), 'png');
  });

  test('M8 resolveImageType 映射表:jpg→jpeg、大小写归一、未知→unknown', () {
    expect(resolveImageType('/tmp/a.jpg'), 'jpeg');
    expect(resolveImageType('/tmp/a.jpeg'), 'jpeg');
    expect(resolveImageType('/tmp/b.PNG'), 'png');
    expect(resolveImageType('/tmp/c.gif'), 'gif');
    expect(resolveImageType('/tmp/d.webp'), 'webp');
    expect(resolveImageType('/tmp/e.heic'), 'heic');
    expect(resolveImageType('/tmp/f.svg'), 'unknown');
    expect(resolveImageType('/tmp/noext'), 'unknown');
  });

  test('M9 isLoadableImageUrl:null/空/非 http(s) → false;http/https(含大写)→ true',
      () {
    expect(isLoadableImageUrl(null), isFalse);
    expect(isLoadableImageUrl(''), isFalse);
    expect(isLoadableImageUrl('ftp://x'), isFalse);
    expect(isLoadableImageUrl('//cdn.example.com/a.png'), isFalse);
    expect(isLoadableImageUrl('https://a.b/c.png'), isTrue);
    expect(isLoadableImageUrl('HTTP://a.b/c.png'), isTrue);
  });

  test('M10 FilePickerFileService.pick 白名单拒绝文案(逐字)', () async {
    final picker = _FakeFilePicker(
      FilePickerResult(<PlatformFile>[
        PlatformFile(path: '/tmp/a.txt', name: 'a.txt', size: 1),
      ]),
    );
    final service = FilePickerFileService(picker: picker);

    await expectLater(
      service.pick(allowedExtensions: <String>['png']),
      throwsA(
        isA<ArgumentError>().having(
          (ArgumentError e) => e.message,
          'message',
          '不支持的文件类型',
        ),
      ),
    );
    expect(picker.lastType, FileType.custom);
    expect(picker.lastAllowedExtensions, <String>['png']);

    final oversize = _FakeFilePicker(
      FilePickerResult(<PlatformFile>[
        PlatformFile(path: '/tmp/big.png', name: 'big.png', size: 11),
      ]),
    );
    await expectLater(
      FilePickerFileService(picker: oversize)
          .pick(allowedExtensions: <String>['png'], maxSizeBytes: 10),
      throwsA(
        isA<ArgumentError>().having(
          (ArgumentError e) => e.message,
          'message',
          '文件超过大小限制',
        ),
      ),
    );
  });
}
