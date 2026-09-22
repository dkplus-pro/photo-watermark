// Package reqctx 请求上下文公共访问器:登录身份与客户端 IP 的注入/读取唯一入口。
// 由 httpapi 中间件注入,oplog 等业务侧只依赖本包,避免业务包反向依赖传输层(F2)。
package reqctx

import (
	"context"
	"net"
	"net/http"
)

// Identity 登录身份(与 auth.Claims 解耦的精简视图,保持本包零 internal 依赖)。
type Identity struct {
	UserID   int64
	Username string
}

type identityKey struct{}

type ipKey struct{}

// WithIdentity 注入登录身份。
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, identityKey{}, id)
}

// IdentityFrom 取登录身份(未注入时 ok=false,身份字段为零值)。
func IdentityFrom(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityKey{}).(Identity)
	return id, ok
}

// ClientIP 取直连客户端 IP(X-Forwarded-For 由反代处理,属部署层职责)。
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// WithClientIP 注入客户端 IP。
func WithClientIP(ctx context.Context, ip string) context.Context {
	return context.WithValue(ctx, ipKey{}, ip)
}

// ClientIPFrom 取客户端 IP(未注入时返回空串)。
func ClientIPFrom(ctx context.Context) string {
	if ip, ok := ctx.Value(ipKey{}).(string); ok {
		return ip
	}
	return ""
}
