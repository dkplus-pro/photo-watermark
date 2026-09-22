package httpapi

import (
	"net/http"

	"github.com/cms-template/server/internal/reqctx"
)

// ClientIP 注入客户端 IP 中间件:挂在链路最前,业务日志等后续环节经 reqctx 读取。
func ClientIP() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(reqctx.WithClientIP(r.Context(), reqctx.ClientIP(r))))
		})
	}
}
