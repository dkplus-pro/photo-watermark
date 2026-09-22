package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// execute 走完整 RequestID 中间件,返回响应与 handler 内取到的 logID。
func execute(t *testing.T, requestID string) (*httptest.ResponseRecorder, string) {
	t.Helper()

	var got string
	handler := RequestID()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = RequestIDFromContext(r.Context())
		WriteJSON(w, http.StatusOK, map[string]string{"hello": "world"})
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/admin/healthz", nil)
	if requestID != "" {
		req.Header.Set(RequestIDHeader, requestID)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec, got
}

func TestRequestIDPassthroughValidHeader(t *testing.T) {
	const incoming = "gateway-req-id_1234"
	rec, got := execute(t, incoming)

	if got != incoming {
		t.Fatalf("context logID = %q, want passthrough %q", got, incoming)
	}
	if header := rec.Header().Get(LogIDHeader); header != incoming {
		t.Fatalf("X-Log-Id header = %q, want %q", header, incoming)
	}
}

func TestRequestIDReplacesInvalidHeader(t *testing.T) {
	for _, incoming := range []string{"short", "with space", "换体中文id", "bad\nid", string(make([]byte, 65))} {
		rec, got := execute(t, incoming)

		if got == incoming {
			t.Fatalf("invalid request id %q should be replaced, got %q", incoming, got)
		}
		if !requestIDPattern.MatchString(got) {
			t.Fatalf("generated id %q does not match pattern", got)
		}
		if header := rec.Header().Get(LogIDHeader); header != got {
			t.Fatalf("X-Log-Id header = %q, want %q", header, got)
		}
	}
}

func TestRequestIDGeneratesWhenAbsent(t *testing.T) {
	rec1, got1 := execute(t, "")
	_, got2 := execute(t, "")

	if !requestIDPattern.MatchString(got1) {
		t.Fatalf("generated id %q does not match pattern", got1)
	}
	if got1 == got2 {
		t.Fatalf("generated ids should differ, got %q twice", got1)
	}
	if header := rec1.Header().Get(LogIDHeader); header != got1 {
		t.Fatalf("X-Log-Id header = %q, want %q", header, got1)
	}
}

func TestRequestIDResponseHeaderPresent(t *testing.T) {
	rec, _ := execute(t, "")
	if header := rec.Header().Get(LogIDHeader); header == "" {
		t.Fatal("X-Log-Id header should always be set")
	}
}

func TestRequestIDContextRoundTrip(t *testing.T) {
	_, got := execute(t, "")
	if got == "" {
		t.Fatal("logID should be retrievable from request context inside handler")
	}
	if RequestIDFromContext(t.Context()) != "" {
		t.Fatal("RequestIDFromContext should return empty string without middleware")
	}
}

func TestRequestIDEnvelopeCarriesLogID(t *testing.T) {
	const incoming = "envelope-log-id-1"
	rec, _ := execute(t, incoming)

	var body struct {
		Code    int            `json:"code"`
		Message string         `json:"message"`
		Data    map[string]any `json:"data"`
		LogID   string         `json:"logID"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if body.LogID != incoming {
		t.Fatalf("envelope logID = %q, want %q", body.LogID, incoming)
	}
	if body.Code != http.StatusOK || body.Data["hello"] != "world" {
		t.Fatalf("unexpected envelope: %s", rec.Body.String())
	}
}

func TestWriteErrorWithoutRequestIDOmitsLogID(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteError(rec, http.StatusBadRequest, "bad request")

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if _, ok := body["logID"]; ok {
		t.Fatalf("logID should be omitted without RequestID middleware, got %v", body["logID"])
	}
}
