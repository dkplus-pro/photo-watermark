package reqctx

import (
	"context"
	"net/http/httptest"
	"testing"
)

func TestIdentityRoundtrip(t *testing.T) {
	ctx := WithIdentity(context.Background(), Identity{UserID: 7, Username: "admin"})
	id, ok := IdentityFrom(ctx)
	if !ok || id.UserID != 7 || id.Username != "admin" {
		t.Fatalf("IdentityFrom = (%+v,%v), want ({7 admin},true)", id, ok)
	}
}

func TestIdentityMissing(t *testing.T) {
	id, ok := IdentityFrom(context.Background())
	if ok || id != (Identity{}) {
		t.Fatalf("未注入时应返回零值与 false, got (%+v,%v)", id, ok)
	}
}

func TestClientIPExtraction(t *testing.T) {
	cases := []struct {
		name string
		addr string
		want string
	}{
		{"host:port", "192.168.1.5:8443", "192.168.1.5"},
		{"缺端口原样返回", "10.0.0.1", "10.0.0.1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/", nil)
			r.RemoteAddr = tc.addr
			if got := ClientIP(r); got != tc.want {
				t.Fatalf("ClientIP(%q) = %q, want %q", tc.addr, got, tc.want)
			}
		})
	}
}

func TestClientIPContext(t *testing.T) {
	if got := ClientIPFrom(context.Background()); got != "" {
		t.Fatalf("未注入时应返回空串, got %q", got)
	}
	ctx := WithClientIP(context.Background(), "203.0.113.9")
	if got := ClientIPFrom(ctx); got != "203.0.113.9" {
		t.Fatalf("ClientIPFrom = %q, want 203.0.113.9", got)
	}
}
