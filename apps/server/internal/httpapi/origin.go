package httpapi

import (
	"log/slog"
	"net/http"
)

// OriginCheck CSRF 纵深防御中间件:非安全方法(GET/HEAD/OPTIONS 之外)且请求带
// Origin 头时,Origin 必须精确命中白名单,否则 403;不带 Origin 的非浏览器调用
// (curl、服务间调用)放行,安全方法跳过。只挂 admin 链,site 链公开只读不挂。
// 白名单来自 CSRF_ALLOWED_ORIGINS(见 docs/server.md "CSRF 与会话安全")。
//
// 结构性前提:当前认证是 Bearer + Authorization 头,服务端不读 Cookie,经典 CSRF
// 不成立;本中间件只是纵深一层,禁止把会话迁往 Cookie(见 docs/server.md)。
func OriginCheck(allowedOrigins []string, logger *slog.Logger) Middleware {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[origin] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}

			origin := r.Header.Get("Origin")
			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}
			if _, ok := allowed[origin]; !ok {
				logger.Warn("origin check rejected",
					"log_id", RequestIDFromContext(r.Context()),
					"method", r.Method,
					"path", r.URL.Path,
					"origin", origin)
				WriteError(w, http.StatusForbidden, "origin not allowed")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
