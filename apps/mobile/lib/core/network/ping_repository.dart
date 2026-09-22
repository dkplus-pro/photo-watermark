import 'package:dio/dio.dart';

import 'package:cms_mobile/core/error/app_error.dart';
import 'package:cms_mobile/core/network/dio_client.dart';
import 'package:cms_mobile/core/network/envelope_interceptor.dart';

/// ping 资源的仓库:`GET /api/app/ping`(契约见 openapi/app/openapi.yaml)。
///
/// 供 home feature(M2.C)与 main 装配临时使用;替代旧 lib/api.dart 的
/// fetchPingMessage(裸 http 调用),网络层统一走 dio + 信封拦截器。
class PingRepository {
  PingRepository(this._dio);

  final Dio _dio;

  static const String _pingPath = '/api/app/ping';

  /// 返回信封 data 载荷中的 `message`(空串合法,原样返回);失败抛 [AppError]。
  Future<String> fetchMessage() async {
    final Response<dynamic> response = await dioCall<dynamic>(
      () => _dio.get<dynamic>(_pingPath),
    );
    return extractPingMessage(response.data);
  }
}

/// 从已解包的 ping 载荷中取 `message`(纯函数,便于单测)。
/// 载荷非对象、缺 `message` 或 `message` 非字符串,抛形态错误的 [AppError]。
String extractPingMessage(Object? payload) {
  if (payload is! Map) {
    throw const AppError(code: 0, message: kMalformedEnvelopeMessage);
  }
  final Object? message = payload['message'];
  if (message is! String) {
    throw const AppError(code: 0, message: kMalformedEnvelopeMessage);
  }
  return message;
}
