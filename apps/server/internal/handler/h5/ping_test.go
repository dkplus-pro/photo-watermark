package h5

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	h5gen "github.com/cms-template/server/gen/h5"
)

// TestPing 经 gen.HandlerFromMux 起完整 mux,验证路由、信封与静态 message。
func TestPing(t *testing.T) {
	mux := http.NewServeMux()
	h5gen.HandlerFromMux(New(nil), mux)

	req := httptest.NewRequest(http.MethodGet, "/api/h5/ping", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control = %q, want %q", cc, "no-store")
	}

	var body struct {
		Code    int        `json:"code"`
		Message string     `json:"message"`
		Data    h5gen.Ping `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if body.Code != http.StatusOK || body.Message != "ok" {
		t.Fatalf("unexpected envelope: %s", rec.Body.String())
	}
	if body.Data.Message != "pong from h5 api" {
		t.Fatalf("data.message = %q, want %q", body.Data.Message, "pong from h5 api")
	}
}
