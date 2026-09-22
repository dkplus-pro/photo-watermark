/// 信封业务错误:HTTP 200 且 `code != 200` 时由网络层抛出。
/// 语义与 JS 端对齐:server `WriteJSON` 形态 `{code, message, data, logID}`。
class AppError implements Exception {
  const AppError({required this.code, required this.message, this.logID});

  /// 信封业务码;非 200 即失败(401/403/404/409/500 由 handler 映射)。
  final int code;

  /// 人话错误信息,可直接展示。
  final String message;

  /// 服务端日志追踪 ID,问题定位用。
  final String? logID;

  @override
  String toString() => 'AppError($code, $message, logID: $logID)';
}
