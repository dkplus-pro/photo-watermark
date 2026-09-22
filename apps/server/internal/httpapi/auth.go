package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"github.com/cms-template/server/internal/auth"
	"github.com/cms-template/server/internal/reqctx"
)

type claimsKey struct{}

// ClaimsFromContext 从请求上下文取认证声明(JWT 中间件写入)。
func ClaimsFromContext(ctx context.Context) (auth.Claims, bool) {
	claims, ok := ctx.Value(claimsKey{}).(auth.Claims)
	return claims, ok
}

// JWTSkipPaths 免认证路径:健康检查、Swagger、登录。
func JWTSkipPaths(paths ...string) map[string]bool {
	skipped := make(map[string]bool, len(paths))
	for _, p := range paths {
		skipped[p] = true
	}
	return skipped
}

// JWTAuth Bearer token 校验中间件:命中 skip 路径直接放行,其余必须携带有效 token。
func JWTAuth(logger *slog.Logger, secret string, skip map[string]bool) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if skip[r.URL.Path] {
				next.ServeHTTP(w, r)
				return
			}

			token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if token == "" || token == r.Header.Get("Authorization") {
				WriteError(w, http.StatusUnauthorized, "未登录或凭证缺失")
				return
			}

			claims, err := auth.VerifyToken(secret, token)
			if err != nil {
				logger.Warn("jwt verify failed", "path", r.URL.Path, "error", err)
				WriteError(w, http.StatusUnauthorized, "登录已过期,请重新登录")
				return
			}

			// 双写:完整 claims 供 handler/权限中间件使用;精简身份视图经 reqctx
			// 供 oplog 等业务侧读取,避免业务包反向依赖 httpapi(F2)。
			ctx := context.WithValue(r.Context(), claimsKey{}, claims)
			ctx = reqctx.WithIdentity(ctx, reqctx.Identity{UserID: claims.UserID, Username: claims.Username})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
