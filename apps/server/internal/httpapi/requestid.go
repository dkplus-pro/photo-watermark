package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"time"
)

type requestIDKey struct{}

// 请求/日志 ID 约定:客户端(网关)可经 X-Request-Id 透传,服务端统一以
// X-Log-Id 响应头与响应体 logID 字段回传,用于把一次请求的访问日志、
// panic 日志与前端报错提示串成完整链路(见 docs/admin-enhancement-plan.md 阶段 9)。
const (
	// RequestIDHeader 入口请求头:已存在且合法则透传,否则服务端生成。
	RequestIDHeader = "X-Request-Id"
	// LogIDHeader 出口响应头:与响应体 envelope 的 logID 字段同值。
	LogIDHeader = "X-Log-Id"
)

// requestIDPattern 限制 ID 字符集与长度(8-64 位字母数字下划线连字符),
// 防止外部输入的换行/控制字符注入日志文件。
var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9-_]{8,64}$`)

// RequestIDFromContext 从请求上下文取本次请求的 logID(未注入时返回空串)。
func RequestIDFromContext(ctx context.Context) string {
	if id, ok := ctx.Value(requestIDKey{}).(string); ok {
		return id
	}
	return ""
}

// newRequestID 生成 16 字节随机数的 hex 编码(32 字符),碰撞概率可忽略;
// crypto/rand 失败极罕见,退化为时间戳 + 进程号(仍满足 ID 约定)。
func newRequestID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%x-%d", time.Now().UnixNano(), os.Getpid())
	}
	return hex.EncodeToString(buf)
}

// requestIDWriter 携带 logID 的响应写入器:WriteJSON/WriteError 经接口断言
// 从最外层中间件套上的这层 wrapper 读取 logID,调用点无需感知(方案 b)。
type requestIDWriter struct {
	http.ResponseWriter
	logID string
}

// LogID 供响应包装层断言读取。
func (w *requestIDWriter) LogID() string { return w.logID }

// Unwrap 供内层 wrapper(如 statusRecorder)逐层穿透找到 logID 载体。
func (w *requestIDWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// RequestID 请求 ID 中间件:挂链路最外层。请求头 X-Request-Id 合法则透传
// (网关生成),否则生成短 ID;写响应头 X-Log-Id 并注入 context,
// 同时给 ResponseWriter 契约一层携带 logID 的 wrapper 供响应包装读取。
func RequestID() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get(RequestIDHeader)
			if !requestIDPattern.MatchString(id) {
				id = newRequestID()
			}
			w.Header().Set(LogIDHeader, id)
			r = r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id))
			next.ServeHTTP(&requestIDWriter{ResponseWriter: w, logID: id}, r)
		})
	}
}
