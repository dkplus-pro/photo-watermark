package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// decodeEnvelope 解析响应体为通用信封,失败即终止测试。
func decodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response body %q: %v", rec.Body.String(), err)
	}
	return body
}

// TestWriteJSONEnvelopeShape 成功信封 {code,message,data} 字段齐全,
// code 与 HTTP 状态码一致(非 200 状态码也不写死),Content-Type 为 JSON。
func TestWriteJSONEnvelopeShape(t *testing.T) {
	const status = http.StatusCreated
	rec := httptest.NewRecorder()
	WriteJSON(rec, status, map[string]any{"id": 7})

	if rec.Code != status {
		t.Fatalf("status = %d, want %d", rec.Code, status)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}

	body := decodeEnvelope(t, rec)
	if code, ok := body["code"].(float64); !ok || int(code) != status {
		t.Fatalf("envelope code = %v, want %d", body["code"], status)
	}
	if body["message"] != "ok" {
		t.Fatalf("envelope message = %v, want %q", body["message"], "ok")
	}
	data, ok := body["data"].(map[string]any)
	if !ok || data["id"] != float64(7) {
		t.Fatalf("envelope data = %v, want payload {id:7}", body["data"])
	}
}

// TestWriteErrorMessageTransparentAndClosed 错误信封 message 原样透出,
// 除 code/message 外不带 data 等任何额外字段(内部细节无从泄露)。
func TestWriteErrorMessageTransparentAndClosed(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteError(rec, http.StatusForbidden, "无权限执行此操作")

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}

	body := decodeEnvelope(t, rec)
	if body["message"] != "无权限执行此操作" {
		t.Fatalf("envelope message = %v, want verbatim message", body["message"])
	}
	if code, ok := body["code"].(float64); !ok || int(code) != http.StatusForbidden {
		t.Fatalf("envelope code = %v, want 403", body["code"])
	}
	for _, key := range []string{"data", "error", "err", "detail", "stack"} {
		if _, present := body[key]; present {
			t.Fatalf("error envelope should not carry %q key, got %v", key, body)
		}
	}
}

// TestWriteErrorCarriesLogID 挂 RequestID 中间件后错误信封带 logID,
// 与 X-Log-Id 响应头同值(缺省场景见 requestid_test.go)。
func TestWriteErrorCarriesLogID(t *testing.T) {
	const requestID = "error-envelope-log-id"
	handler := RequestID()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		WriteError(w, http.StatusUnauthorized, "未登录或凭证缺失")
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
	req.Header.Set(RequestIDHeader, requestID)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	body := decodeEnvelope(t, rec)
	if body["logID"] != requestID {
		t.Fatalf("envelope logID = %v, want %q", body["logID"], requestID)
	}
}
