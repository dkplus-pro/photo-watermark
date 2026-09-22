// media 组 JSB 方法单测(MM 系列,阶段 6 方案 §4.3.5):fake 闭包注入,纯 Dart。
import 'dart:convert';

import 'package:cms_mobile/core/hybrid/jsb_methods/media.dart';
import 'package:cms_mobile/core/hybrid/jsb_registry.dart';
import 'package:cms_mobile/core/permission/permission_service.dart';
import 'package:flutter_test/flutter_test.dart';

/// media 依赖 spy:固定返回值/抛错 + 全部调用计数。
class _MediaSpy {
  _MediaSpy({
    this.permissionState = PermissionAppState.granted,
    this.galleryResult,
    this.infoWidth = 100,
  });

  PermissionAppState permissionState;
  Object? permissionError;
  JSBPickedImage? galleryResult;
  int? infoWidth;
  int? infoHeight = 50;
  int infoSizeBytes = 4;
  List<int> fileBytes = const <int>[0, 1, 2, 3];

  int galleryCalls = 0;
  int cameraCalls = 0;
  int saveCalls = 0;
  int readInfoCalls = 0;
  int readBytesCalls = 0;
  int hintNonPermanentCalls = 0;
  int hintPermanentCalls = 0;

  JSBMediaDependencies deps() => JSBMediaDependencies(
        ensurePermission: (permission) async {
          final Object? error = permissionError;
          if (error != null) {
            throw error;
          }
          return permissionState;
        },
        showPermissionDeniedHint: (permission, {required permanentlyDenied}) {
          permanentlyDenied ? hintPermanentCalls++ : hintNonPermanentCalls++;
        },
        pickFromGallery: ({required maxDim, required quality}) async {
          galleryCalls++;
          return galleryResult;
        },
        pickFromCamera: ({required maxDim, required quality}) async {
          cameraCalls++;
          return null;
        },
        saveToAlbum: (path) async {
          saveCalls++;
        },
        readImageInfo: (path) async {
          readInfoCalls++;
          return (
            path: path,
            width: infoWidth,
            height: infoHeight,
            sizeBytes: infoSizeBytes,
          );
        },
        readFileBytes: (path) async {
          readBytesCalls++;
          return fileBytes;
        },
      );
}

Matcher _jsbError(String code, String? message) {
  final matcher = isA<JSBException>().having((e) => e.code, 'code', code);
  return message == null
      ? matcher
      : matcher.having((e) => e.message, 'message', message);
}

void main() {
  test('MM1 method 名清单与 buildMediaHandlers 键集一致', () {
    final handlers = buildMediaHandlers(_MediaSpy().deps());
    expect(handlers.keys.toSet(), mediaJSBMethodNames.toSet());
    expect(handlers.keys.toSet().length, mediaJSBMethodNames.length);
  });

  test('MM2 chooseImage 正常:granted + fake 选图 → {tempPath,sizeBytes},无 dataUrl',
      () async {
    final spy = _MediaSpy(
      galleryResult: (
        path: '/tmp/a.jpg',
        width: null,
        height: null,
        sizeBytes: 5
      ),
    );
    final handlers = buildMediaHandlers(spy.deps());

    final data = (await handlers['chooseImage']!(const <String, dynamic>{}))!;
    expect(data, <String, dynamic>{'tempPath': '/tmp/a.jpg', 'sizeBytes': 5});
    expect(data.containsKey('width'), isFalse);
    expect(data.containsKey('height'), isFalse);
    expect(data.containsKey('dataUrl'), isFalse);
    expect(spy.hintNonPermanentCalls, 0);
    expect(spy.galleryCalls, 1);
  });

  test('MM3 chooseImage 参数类型错/越界 → BAD_PARAMS', () async {
    final handlers = buildMediaHandlers(_MediaSpy().deps());

    for (final params in <Map<String, dynamic>>[
      const {'maxDim': 0},
      const {'maxDim': 5000},
      const {'maxDim': 'abc'},
      const {'quality': -1},
      const {'quality': 'x'},
      const {'withBase64': 'yes'},
    ]) {
      await expectLater(
        handlers['chooseImage']!(params),
        throwsA(_jsbError(kJSBErrBadParams, null)),
        reason: 'params: $params',
      );
    }
  });

  test('MM4 chooseImage fake 返回 null → CANCELLED 「用户已取消」', () async {
    final spy = _MediaSpy(galleryResult: null);
    final handlers = buildMediaHandlers(spy.deps());

    await expectLater(
      handlers['chooseImage']!(const <String, dynamic>{}),
      throwsA(_jsbError(kJSBErrCancelled, '用户已取消')),
    );
    expect(spy.galleryCalls, 1);
  });

  test('MM5 chooseImage denied(request 后仍 denied)→ PERMISSION_DENIED + 首次说明提示',
      () async {
    final spy = _MediaSpy(permissionState: PermissionAppState.denied);
    final handlers = buildMediaHandlers(spy.deps());

    await expectLater(
      handlers['chooseImage']!(const <String, dynamic>{}),
      throwsA(_jsbError(kJSBErrPermissionDenied, '未获得相册权限,已取消本次操作。')),
    );
    expect(spy.hintNonPermanentCalls, 1);
    expect(spy.hintPermanentCalls, 0);
    expect(spy.galleryCalls, 0);
  });

  test(
      'MM6 takePhoto permanentlyDenied → PERMISSION_DENIED + 永久拒绝提示(settingsHint 文案);pick 未被调',
      () async {
    final spy =
        _MediaSpy(permissionState: PermissionAppState.permanentlyDenied);
    final handlers = buildMediaHandlers(spy.deps());

    await expectLater(
      handlers['takePhoto']!(const <String, dynamic>{}),
      throwsA(_jsbError(kJSBErrPermissionDenied, '相机权限已被关闭,请在系统设置中开启后再试。')),
    );
    expect(spy.hintPermanentCalls, 1);
    expect(spy.hintNonPermanentCalls, 0);
    expect(spy.cameraCalls, 0);
  });

  test('MM7 takePhoto restricted → 按永久拒绝分支(hint true + settingsHint 文案)',
      () async {
    final spy = _MediaSpy(permissionState: PermissionAppState.restricted);
    final handlers = buildMediaHandlers(spy.deps());

    await expectLater(
      handlers['takePhoto']!(const <String, dynamic>{}),
      throwsA(_jsbError(kJSBErrPermissionDenied, '相机权限已被关闭,请在系统设置中开启后再试。')),
    );
    expect(spy.hintPermanentCalls, 1);
    expect(spy.cameraCalls, 0);
  });

  test('MM8 limited 视为可用 → 正常走完选图', () async {
    final spy = _MediaSpy(
      permissionState: PermissionAppState.limited,
      galleryResult: (path: '/tmp/b.jpg', width: 10, height: 20, sizeBytes: 8),
    );
    final handlers = buildMediaHandlers(spy.deps());

    final data = (await handlers['chooseImage']!(const <String, dynamic>{}))!;
    expect(data['tempPath'], '/tmp/b.jpg');
    expect(data['sizeBytes'], 8);
    expect(spy.galleryCalls, 1);
  });

  test('MM9 withBase64:恰好 1MB 内联 dataUrl;1MB+1 静默省略', () async {
    final inline = _MediaSpy(
      galleryResult: (
        path: '/tmp/pic.jpg',
        width: 1,
        height: 1,
        sizeBytes: 1024 * 1024
      ),
    );
    final data = (await buildMediaHandlers(
      inline.deps(),
    )['chooseImage']!(const <String, dynamic>{'withBase64': true}))!;
    expect(
      data['dataUrl'],
      'data:image/jpeg;base64,${base64Encode(inline.fileBytes)}',
    );
    expect(inline.readBytesCalls, 1);

    final skipped = _MediaSpy(
      galleryResult: (
        path: '/tmp/pic.jpg',
        width: 1,
        height: 1,
        sizeBytes: 1024 * 1024 + 1,
      ),
    );
    final skippedData = (await buildMediaHandlers(
      skipped.deps(),
    )['chooseImage']!(const <String, dynamic>{'withBase64': true}))!;
    expect(skippedData.containsKey('dataUrl'), isFalse);
    expect(skipped.readBytesCalls, 0);
  });

  test('MM10 getImageInfo tempPath 缺失/空串/非字符串 → BAD_PARAMS', () async {
    final handlers = buildMediaHandlers(_MediaSpy().deps());

    for (final params in <Map<String, dynamic>>[
      const <String, dynamic>{},
      const {'tempPath': '   '},
      const {'tempPath': 123},
    ]) {
      await expectLater(
        handlers['getImageInfo']!(params),
        throwsA(_jsbError(kJSBErrBadParams, null)),
        reason: 'params: $params',
      );
    }
  });

  test(
      'MM11 getImageInfo fake 返回 width=null → 穿透抛错(非 JSBException);registry 兜底 NATIVE_ERROR',
      () async {
    final spy = _MediaSpy(infoWidth: null);
    final handlers = buildMediaHandlers(spy.deps());

    await expectLater(
      handlers['getImageInfo']!(const {'tempPath': '/tmp/a.jpg'}),
      throwsA(isNot(isA<JSBException>())),
    );

    final registry = JSBRegistry()..registerAll(buildMediaHandlers(spy.deps()));
    final envelope = await registry
        .dispatch('getImageInfo', const {'tempPath': '/tmp/a.jpg'});
    expect(envelope['code'], kJSBCodeNativeError);
    final error = envelope['error'] as Map<String, dynamic>;
    expect(error['code'], kJSBErrNativeError);
  });

  test(
      'MM12 saveImageToAlbum 正常 → 返回 null(信封 {code:0});权限 denied → PERMISSION_DENIED 且 save 未调',
      () async {
    final spy = _MediaSpy();
    final handlers = buildMediaHandlers(spy.deps());
    expect(
      await handlers['saveImageToAlbum']!(const {'tempPath': '/tmp/a.jpg'}),
      isNull,
    );
    final registry = JSBRegistry()
      ..registerAll(buildMediaHandlers(_MediaSpy().deps()));
    final envelope = await registry
        .dispatch('saveImageToAlbum', const {'tempPath': '/tmp/a.jpg'});
    expect(envelope.containsKey('data'), isFalse);
    expect(envelope['code'], kJSBResultOk);

    final denied = _MediaSpy(permissionState: PermissionAppState.denied);
    await expectLater(
      buildMediaHandlers(denied.deps())['saveImageToAlbum']!(
        const {'tempPath': '/tmp/a.jpg'},
      ),
      throwsA(_jsbError(kJSBErrPermissionDenied, '未获得相册权限,已取消本次操作。')),
    );
    expect(denied.saveCalls, 0);
  });

  test('MM13 ensurePermission fake 抛异常 → 原样穿透', () async {
    final error = StateError('channel failure');
    final spy = _MediaSpy()..permissionError = error;
    final handlers = buildMediaHandlers(spy.deps());

    await expectLater(
      handlers['chooseImage']!(const <String, dynamic>{}),
      throwsA(same(error)),
    );
  });

  test('MM14 registry 集成:dispatch 拼写错误 method → METHOD_NOT_FOUND(1001)',
      () async {
    final registry = JSBRegistry()
      ..registerAll(buildMediaHandlers(_MediaSpy().deps()));

    final envelope =
        await registry.dispatch('chooseimage', const <String, dynamic>{});
    expect(envelope['code'], kJSBCodeMethodNotFound);
    final error = envelope['error'] as Map<String, dynamic>;
    expect(error['code'], kJSBErrMethodNotFound);
  });
}
