package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// originTestLogger 静默日志,避免测试输出噪声。
var originTestLogger = slog.New(slog.NewTextHandler(&discardWriter{}, nil))

type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }

// executeOrigin 走 RequestID + OriginCheck 链,返回响应与 handler 是否被放行。
func executeOrigin(t *testing.T, method, origin string, allowed []string) (*httptest.ResponseRecorder, bool) {
	t.Helper()

	passed := false
	handler := Chain(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			passed = true
			WriteJSON(w, http.StatusOK, map[string]string{"ok": "1"})
		}),
		RequestID(),
		OriginCheck(allowed, originTestLogger),
	)

	req := httptest.NewRequest(method, "/api/admin/users", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec, passed
}

func TestOriginCheckAllowedOriginPasses(t *testing.T) {
	rec, passed := executeOrigin(t, http.MethodPost, "http://localhost:8081",
		[]string{"http://localhost:8081"})

	if !passed {
		t.Fatal("request from whitelisted origin should reach handler")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestOriginCheckUnknownOriginRejected(t *testing.T) {
	for _, origin := range []string{
		"https://evil.example.com",
		"http://localhost:8082",
		"http://localhost:8081.evil.com",
		"http://localhost:8081/",
		"http://localhost:8081 ", // 尾随空格:Origin 头不做 trim,须精确匹配
	} {
		rec, passed := executeOrigin(t, http.MethodDelete, origin, []string{"http://localhost:8081"})
		if passed {
			t.Fatalf("origin %q should be rejected", origin)
		}
		if rec.Code != http.StatusForbidden {
			t.Fatalf("origin %q: status = %d, want 403", origin, rec.Code)
		}
		var body struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode error body: %v", err)
		}
		if body.Code != http.StatusForbidden {
			t.Fatalf("origin %q: envelope code = %d, want 403", origin, body.Code)
		}
	}
}

func TestOriginCheckNoOriginPasses(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodDelete, http.MethodPut, http.MethodPatch} {
		_, passed := executeOrigin(t, method, "", []string{"http://localhost:8081"})
		if !passed {
			t.Fatalf("%s without Origin header (curl/service call) should pass", method)
		}
	}
}

func TestOriginCheckSafeMethodsSkip(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodOptions} {
		_, passed := executeOrigin(t, method, "https://evil.example.com", []string{"http://localhost:8081"})
		if !passed {
			t.Fatalf("safe method %s should skip origin check even with foreign origin", method)
		}
	}
}

func TestOriginCheckMultipleAllowedOrigins(t *testing.T) {
	allowed := []string{"https://admin.example.com", "http://localhost:8081", "https://staging.example.com"}
	for _, origin := range allowed {
		_, passed := executeOrigin(t, http.MethodPost, origin, allowed)
		if !passed {
			t.Fatalf("origin %q should be allowed (multiple-entry whitelist)", origin)
		}
	}
}

func TestOriginCheckEmptyWhitelistRejectsAllBrowsers(t *testing.T) {
	// 白名单为空:仍放行无 Origin 的非浏览器调用,但拒绝任何带 Origin 的写请求。
	_, passed := executeOrigin(t, http.MethodPost, "", nil)
	if !passed {
		t.Fatal("no-Origin request should pass even with empty whitelist")
	}
	rec, passed := executeOrigin(t, http.MethodPost, "http://localhost:8081", nil)
	if passed || rec.Code != http.StatusForbidden {
		t.Fatalf("empty whitelist should reject any Origin, got passed=%v status=%d", passed, rec.Code)
	}
}
