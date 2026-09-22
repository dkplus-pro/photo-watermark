import 'package:dio/dio.dart';

import 'package:cms_mobile/core/error/app_error.dart';
import 'package:cms_mobile/core/network/dio_client.dart';
import 'package:cms_mobile/core/network/envelope_interceptor.dart';

/// 版本检查数据(record 形态载荷,非契约 DTO 类;字段与 openapi/app version-check.yaml 一一对应)。
typedef VersionCheckData = ({
  bool hasUpdate,
  bool forceUpdate,
  String latestVersion,
  String downloadUrl,
  String releaseNotes,
});

/// version/check 仓库:GET /api/app/version/check(契约见 openapi/app/paths/version-check.yaml);
/// 走 dioCall 边界,只抛 AppError;支持可选 CancelToken(页面销毁取消)。
class VersionRepository {
  VersionRepository(this._dio);

  final Dio _dio;

  static const String _path = '/api/app/version/check';

  Future<VersionCheckData> check({
    required String
        platform, // 'ios' | 'android'(调用方经 resolveRequestPlatform 归一)
    required String version,
    CancelToken? cancelToken,
  }) async {
    final Response<dynamic> response = await dioCall<dynamic>(
      () => _dio.get<dynamic>(
        _path,
        queryParameters: <String, dynamic>{
          'platform': platform,
          'version': version
        },
        cancelToken: cancelToken,
      ),
      cancelToken: cancelToken,
    );
    return parseVersionCheckData(response.data);
  }
}

/// 载荷解析(纯函数,照 extractPingMessage 范式):非对象/缺键/类型错 →
/// AppError(kMalformedEnvelopeMessage);五个键全必填(契约 required),
/// bool 只接受 bool、string 只接受 String。
VersionCheckData parseVersionCheckData(Object? payload) {
  if (payload is! Map) {
    throw const AppError(code: 0, message: kMalformedEnvelopeMessage);
  }
  final Object? hasUpdate = payload['hasUpdate'];
  final Object? forceUpdate = payload['forceUpdate'];
  final Object? latestVersion = payload['latestVersion'];
  final Object? downloadUrl = payload['downloadUrl'];
  final Object? releaseNotes = payload['releaseNotes'];
  if (hasUpdate is! bool ||
      forceUpdate is! bool ||
      latestVersion is! String ||
      downloadUrl is! String ||
      releaseNotes is! String) {
    throw const AppError(code: 0, message: kMalformedEnvelopeMessage);
  }
  return (
    hasUpdate: hasUpdate,
    forceUpdate: forceUpdate,
    latestVersion: latestVersion,
    downloadUrl: downloadUrl,
    releaseNotes: releaseNotes,
  );
}
