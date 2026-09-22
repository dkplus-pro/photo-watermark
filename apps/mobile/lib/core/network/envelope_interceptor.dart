import 'package:dio/dio.dart';

import 'package:cms_mobile/core/error/app_error.dart';

/// 通用文案:传输层失败(断网/超时等)对用户的统一话术。
const String kNetworkErrorMessage = '网络连接失败';

/// 通用文案:响应体不是合法信封(空体/非对象/非法 JSON)时对用户的话术。
const String kMalformedEnvelopeMessage = '响应数据格式错误,请稍后重试';

/// 通用文案:信封缺 message 或 message 非字符串时的兜底话术。
const String kGenericRequestFailedMessage = '请求失败,请稍后重试';

/// 信封拦截器:对齐 server `WriteJSON` 的统一响应形态 `{code, message, data, logID}`。
///
/// - HTTP 2xx 且 `code == 200`:把 `response.data` 替换为信封 `data` 载荷(解包);
/// - HTTP 2xx 但 `code != 200`(或缺字段/形态不对):抛 [AppError](dio 会包进
///   DioException.error,由调用边界的 `dioCall` 解出);
/// - HTTP 非 2xx 与传输层失败:在 [onError] 归一为携带 [AppError] 的
///   DioException,message 用通用文案,不透传服务端内部细节(logID 是定位用的
///   追踪 ID,不属于内部细节,可提取)。
///
/// 本拦截器只处理 JSON 响应(`responseType == json`),其余类型原样放行。
class EnvelopeInterceptor extends Interceptor {
  const EnvelopeInterceptor();

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    if (response.requestOptions.responseType != ResponseType.json) {
      handler.next(response);
      return;
    }

    final Object? body = response.data;
    if (body is! Map) {
      // 空响应体、JSON null、数组、字符串等:信封形态不成立。
      throw const AppError(code: 0, message: kMalformedEnvelopeMessage);
    }

    final int? code = parseEnvelopeCode(body['code']);
    if (code != 200) {
      throw AppError(
        code: code ?? 0,
        message: _messageOf(body),
        logID: envelopeLogID(body),
      );
    }

    // code == 200:解包,后续拦截器与调用方只看信封 data 载荷。
    response.data = body['data'];
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    // 业务错误(信封 code != 200 等)已在 onResponse 包成 AppError,原样放行。
    if (err.error is AppError) {
      handler.next(err);
      return;
    }

    if (err.type == DioExceptionType.badResponse) {
      final int statusCode = err.response?.statusCode ?? 0;
      handler.reject(
        withAppError(
          err,
          AppError(
            code: statusCode,
            // 通用文案,不透传服务端内部错误细节。
            message: messageForStatus(statusCode),
            logID: envelopeLogID(err.response?.data),
          ),
        ),
      );
      return;
    }

    if (err.error is FormatException) {
      // content-type 为 JSON 但响应体不是合法 JSON。
      handler.reject(
        withAppError(
          err,
          const AppError(code: 0, message: kMalformedEnvelopeMessage),
        ),
      );
      return;
    }

    // 其余(连接/收发超时、断网、取消等传输层失败)统一按网络失败处理。
    handler.reject(
      withAppError(
        err,
        const AppError(code: 0, message: kNetworkErrorMessage),
      ),
    );
  }
}

/// 把 [AppError] 装回 DioException.error:dio 的公开 API 只会抛 DioException,
/// 调用边界(`dioCall`)再解出 AppError。
DioException withAppError(DioException err, AppError appError) => DioException(
      requestOptions: err.requestOptions,
      error: appError,
      type: err.type,
      stackTrace: err.stackTrace,
    );

/// 信封 code 解析:兼容字符串数字(如代理层把 int 序列化成 "200"),其余返回 null。
int? parseEnvelopeCode(Object? raw) {
  if (raw is int) {
    return raw;
  }
  if (raw is String) {
    return int.tryParse(raw);
  }
  return null;
}

/// 从信封(或错误体)中提取 logID,缺失或非字符串返回 null。
String? envelopeLogID(Object? body) {
  if (body is Map && body['logID'] is String) {
    return body['logID'] as String;
  }
  return null;
}

/// HTTP 状态码到用户文案的映射,只出通用话术,不透传内部细节。
String messageForStatus(int statusCode) {
  if (statusCode == 401) {
    return '登录状态已失效,请重新登录';
  }
  if (statusCode == 403) {
    return '没有操作权限';
  }
  if (statusCode == 404) {
    return '请求的资源不存在';
  }
  if (statusCode >= 500) {
    return '服务暂时不可用,请稍后重试';
  }
  return kGenericRequestFailedMessage;
}

String _messageOf(Map<Object?, Object?> body) {
  final Object? message = body['message'];
  if (message is String && message.isNotEmpty) {
    return message;
  }
  return kGenericRequestFailedMessage;
}
