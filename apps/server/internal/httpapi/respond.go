// Package httpapi 提供与具体业务无关的 HTTP 基础设施:统一响应、错误封装与中间件链。
package httpapi

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// logIDFromWriter 经接口断言逐层穿透 ResponseWriter wrapper,读取
// RequestID 中间件挂上的 logID(无中间件或为空时返回空串)。
func logIDFromWriter(w http.ResponseWriter) string {
	for depth := 0; depth < 8; depth++ {
		if carrier, ok := w.(interface{ LogID() string }); ok {
			return carrier.LogID()
		}
		inner, ok := w.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			return ""
		}
		w = inner.Unwrap()
	}
	return ""
}

// WriteJSON 以统一响应包装写出:`{code, message, data, logID}`(code 等于 HTTP 状态码,
// logID 来自 RequestID 中间件,无则省略)。
// 契约描述的是 data 载荷,解包由 admin 的 mutator 统一处理(见 openapi/admin.yaml 说明)。
func WriteJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if status == http.StatusNoContent || body == nil {
		return
	}
	envelope := map[string]any{
		"code":    status,
		"message": "ok",
		"data":    body,
	}
	if logID := logIDFromWriter(w); logID != "" {
		envelope["logID"] = logID
	}
	if err := json.NewEncoder(w).Encode(envelope); err != nil {
		slog.Error("write json response", "error", err)
	}
}

// WriteError 写出契约中定义的 Error 结构(错误不套 data 包装,附带 logID)。
func WriteError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	envelope := map[string]any{"code": status, "message": message}
	if logID := logIDFromWriter(w); logID != "" {
		envelope["logID"] = logID
	}
	if err := json.NewEncoder(w).Encode(envelope); err != nil {
		slog.Error("write error response", "error", err)
	}
}

// DecodeRequest 解析 JSON 请求体。
func DecodeRequest(r *http.Request, v any) error {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return fmt.Errorf("decode request body: %w", err)
	}
	return nil
}

// Middleware 标准 http 中间件签名。
type Middleware func(http.Handler) http.Handler

// Chain 按声明顺序包裹 handler,先声明的在外层。
func Chain(handler http.Handler, middlewares ...Middleware) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		handler = middlewares[i](handler)
	}
	return handler
}

// statusRecorder 记录响应状态码,供日志中间件使用。
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// Unwrap 供响应包装层穿透到内层 wrapper(如 requestIDWriter)读取 logID。
func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

// Logging 请求日志:方法、路径、状态码、耗时与 log_id(便于按 logID 检索单次请求)。
func Logging(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			logger.Info("http request",
				"log_id", RequestIDFromContext(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"latency_ms", time.Since(start).Milliseconds(),
			)
		})
	}
}

// Recover panic 兜底:捕获后返回 500,避免进程退出。
func Recover(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					logger.Error("http panic recovered",
						"log_id", RequestIDFromContext(r.Context()),
						"panic", rec,
						"path", r.URL.Path)
					WriteError(w, http.StatusInternalServerError, "internal server error")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}
