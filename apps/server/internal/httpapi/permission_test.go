package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/cms-template/server/internal/auth"
)

// TestMatchRoutePermission 覆盖 {id} 通配、段数不等、cutset 误吃三类边界。
// 其中 cutset 用例针对 strings.Trim(path, "/api/admin/") 的字符集误吃:
// 尾段字符全部落在 cutset(/,a,p,i,d,m,n)内时整段被吃掉,段数变化导致漏配(权限静默降级)。
func TestMatchRoutePermission(t *testing.T) {
	cases := []struct {
		name   string
		method string
		path   string
		code   string
		ok     bool
	}{
		{"字面匹配", "GET", "/api/admin/users", "system:user:list", true},
		{"{id} 通配", "GET", "/api/admin/users/42", "system:user:list", true},
		{"{id} 通配写操作", "PUT", "/api/admin/users/42", "system:user:update", true},
		{"多段通配", "PUT", "/api/admin/dicts/c1/items/9", "system:dict:update", true},
		{"带子路径通配", "PATCH", "/api/admin/users/42/status", "system:user:update", true},
		{"cutset 尾段整段误吃", "PUT", "/api/admin/users/main", "system:user:update", true},
		{"cutset 尾段整段误吃(删除)", "DELETE", "/api/admin/dicts/ma", "system:dict:delete", true},
		{"cutset 尾段整段误吃(角色)", "PUT", "/api/admin/roles/pan", "system:role:update", true},
		{"cutset 前缀误吃自愈", "GET", "/api/admin/media-groups", "media:group:list", true},
		{"段数不等", "GET", "/api/admin/users/42/extra", "", false},
		{"方法不存在", "DELETE", "/api/admin/users", "", false},
		{"非 admin 前缀", "GET", "/api/app/ping", "", false},
		{"公开端点不入注册表", "POST", "/api/admin/auth/login", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, ok := MatchRoutePermission(tc.method, tc.path)
			if ok != tc.ok || code != tc.code {
				t.Fatalf("MatchRoutePermission(%q,%q) = (%q,%v), want (%q,%v)",
					tc.method, tc.path, code, ok, tc.code, tc.ok)
			}
		})
	}
}

// executePermission 走 PermissionCheck 中间件(claims 可选注入模拟 JWT 层产物),
// 返回响应、下游 handler 是否放行与 loader 是否被调用。
func executePermission(t *testing.T, method, path string, claims *auth.Claims, loader PermissionCodesLoader, logger *slog.Logger) (*httptest.ResponseRecorder, bool, bool) {
	t.Helper()

	passed, loaderCalled, gotUserID := false, false, int64(-1)
	recordLoader := func(ctx context.Context, userID int64) ([]string, error) {
		loaderCalled = true
		gotUserID = userID
		return loader(ctx, userID)
	}
	handler := PermissionCheck(recordLoader, logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		passed = true
		WriteJSON(w, http.StatusOK, map[string]string{"ok": "1"})
	}))

	req := httptest.NewRequest(method, path, nil)
	if claims != nil {
		req = req.WithContext(context.WithValue(req.Context(), claimsKey{}, *claims))
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if loaderCalled && claims != nil && gotUserID != claims.UserID {
		t.Fatalf("loader userID = %d, want %d from claims", gotUserID, claims.UserID)
	}
	return rec, passed, loaderCalled
}

// TestPermissionCheckAllowedPasses 命中注册表且持有权限码:放行,loader 收到 claims 的 userID。
func TestPermissionCheckAllowedPasses(t *testing.T) {
	rec, passed, _ := executePermission(t, http.MethodGet, "/api/admin/users",
		&auth.Claims{UserID: 1, Username: "admin"},
		func(ctx context.Context, userID int64) ([]string, error) {
			return []string{"system:user:list"}, nil
		}, originTestLogger)

	if !passed {
		t.Fatal("request with required permission should reach handler")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

// TestPermissionCheckDeniedForbidden 命中注册表但权限码不匹配:403,下游不执行。
func TestPermissionCheckDeniedForbidden(t *testing.T) {
	rec, passed, _ := executePermission(t, http.MethodPost, "/api/admin/users",
		&auth.Claims{UserID: 1, Username: "admin"},
		func(ctx context.Context, userID int64) ([]string, error) {
			return []string{"system:user:list"}, nil // 只有读权限,没有 system:user:create
		}, originTestLogger)

	if passed {
		t.Fatal("handler should not run without required permission")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	body := decodeEnvelope(t, rec)
	if body["message"] != "无权限执行此操作" {
		t.Fatalf("envelope message = %v, want %q", body["message"], "无权限执行此操作")
	}
}

// TestPermissionCheckUnauthenticatedUnauthorized 命中注册表但无 claims
// (JWT 中间件未注入):401,loader 不应被调用。
func TestPermissionCheckUnauthenticatedUnauthorized(t *testing.T) {
	rec, passed, loaderCalled := executePermission(t, http.MethodGet, "/api/admin/users",
		nil,
		func(ctx context.Context, userID int64) ([]string, error) {
			return []string{"system:user:list"}, nil
		}, originTestLogger)

	if passed || loaderCalled {
		t.Fatalf("unauthenticated request should be rejected, passed=%v loaderCalled=%v", passed, loaderCalled)
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

// TestPermissionCheckUnregisteredRoutePasses 未命中注册表:登录即可语义,
// 无 claims、不查权限码也放行(公开端点如 login 不需要权限码)。
func TestPermissionCheckUnregisteredRoutePasses(t *testing.T) {
	_, passed, loaderCalled := executePermission(t, http.MethodPost, "/api/admin/auth/login",
		nil,
		func(ctx context.Context, userID int64) ([]string, error) {
			t.Error("loader should not be called for unregistered route")
			return nil, nil
		}, originTestLogger)

	if !passed {
		t.Fatal("unregistered route should pass through without permission check")
	}
	if loaderCalled {
		t.Fatal("loader should not be called for unregistered route")
	}
}

// TestPermissionCheckLoaderErrorInternalError loader 失败:500 且只透出通用文案,
// 不泄露 loader 内部错误细节;静默 logger(originTestLogger)下无输出噪声。
// 注:PermissionCheck 的 logger 参数不支持 nil(slog 对 nil receiver 调 Error 会 panic),
// 测试侧统一注入静默 logger;生产装配由 main.go 传入真实 logger。
func TestPermissionCheckLoaderErrorInternalError(t *testing.T) {
	rec, passed, _ := executePermission(t, http.MethodGet, "/api/admin/users",
		&auth.Claims{UserID: 1, Username: "admin"},
		func(ctx context.Context, userID int64) ([]string, error) {
			return nil, errors.New("db connection refused with secret dsn")
		}, originTestLogger)

	if passed {
		t.Fatal("handler should not run when loader fails")
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	body := decodeEnvelope(t, rec)
	if body["message"] != "internal server error" {
		t.Fatalf("envelope message = %v, want generic %q", body["message"], "internal server error")
	}
	if got := rec.Body.String(); strings.Contains(got, "db connection refused") {
		t.Fatalf("internal loader error detail leaked: %s", got)
	}
}

// TestPermissionCheckEmptyPermissionCodes 空权限码列表:不含所需权限码,403。
func TestPermissionCheckEmptyPermissionCodes(t *testing.T) {
	rec, passed, _ := executePermission(t, http.MethodDelete, "/api/admin/users/42",
		&auth.Claims{UserID: 1, Username: "admin"},
		func(ctx context.Context, userID int64) ([]string, error) {
			return []string{}, nil
		}, originTestLogger)

	if passed {
		t.Fatal("handler should not run with empty permission codes")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}
