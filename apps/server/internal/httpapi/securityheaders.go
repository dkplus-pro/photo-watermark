package httpapi

import "net/http"

// SecurityHeaders 安全响应头中间件,admin 与 site 两条链都挂(最外层附近,
// 保证错误响应同样带安全头):
//   - X-Content-Type-Options: nosniff 阻止 MIME 嗅探;
//   - X-Frame-Options: DENY 禁止被 iframe 嵌入(点击劫持);
//   - Referrer-Policy: strict-origin-when-cross-origin 限制跨站引用泄露完整 URL;
//   - Cache-Control: no-store 鉴权数据不经共享缓存。
//
// Swagger 页面注册在 root mux、不经过中间件链,需加载自身静态资源,无需处理;
// CSP 暂不施加(见 TODO 与 docs/admin-enhancement-plan.md 阶段 10)。
func SecurityHeaders() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			h.Set("Cache-Control", "no-store")
			// TODO: 按部署形态细化并施加 Content-Security-Policy(API 响应通常由
			// 浏览器直接消费,meta/响应头 CSP 的策略源在前端托管层,暂不在此施加)。
			next.ServeHTTP(w, r)
		})
	}
}
