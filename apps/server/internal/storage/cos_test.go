package storage

import (
	"bytes"
	"context"
	"hash/crc64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"

	cos "github.com/tencentyun/cos-go-sdk-v5"
)

// newTestCOS 构造指向 httptest 桩的 COS 实例(同包测试,绕过真实域名)。
// 桩模拟 COS 的 CRC64 回执:SDK 上传后校验 x-cos-hash-crc64ecma 响应头。
func newTestCOS(t *testing.T, handler http.Handler) *COS {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			body, _ := io.ReadAll(r.Body)
			r.Body = io.NopCloser(bytes.NewReader(body))
			table := crc64.MakeTable(crc64.ECMA)
			w.Header().Set("x-cos-hash-crc64ecma", strconv.FormatUint(crc64.Update(0, table, body), 10))
		}
		handler.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("parse stub url: %v", err)
	}
	client := cos.NewClient(&cos.BaseURL{BucketURL: u}, &http.Client{
		Transport: &cos.AuthorizationTransport{SecretID: "test-id", SecretKey: "test-key"},
	})
	return &COS{client: client, cdnDomain: "https://cdn.example.com", prefix: "tmp/"}
}

// TestCOSSavePutsObject 上传:PUT 到带前缀的对象路径,返回 key/字节数,URL 为 CDN 直链。
func TestCOSSavePutsObject(t *testing.T) {
	var gotMethod, gotPath, gotBody string
	store := newTestCOS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		w.WriteHeader(http.StatusOK)
	}))

	key, size, err := store.Save(context.Background(), strings.NewReader("hello"), "png")
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if size != 5 {
		t.Fatalf("size = %d, want 5", size)
	}
	if !strings.HasPrefix(key, "tmp/") || !strings.HasSuffix(key, ".png") {
		t.Fatalf("key %q should carry prefix and ext", key)
	}
	if gotMethod != http.MethodPut || gotPath != "/"+key {
		t.Fatalf("stub got %s %s, want PUT /%s", gotMethod, gotPath, key)
	}
	if gotBody != "hello" {
		t.Fatalf("stub body = %q, want hello", gotBody)
	}
	if want := "https://cdn.example.com/" + key; store.URL(key) != want {
		t.Fatalf("url = %q, want %q", store.URL(key), want)
	}
}

// nonSeekable 包一层隐藏 io.Seeker,模拟网络流式请求体。
type nonSeekable struct{ io.Reader }

// TestCOSSaveSpoolsStream 不可寻址的 reader 先落临时文件再上传,内容不丢。
func TestCOSSaveSpoolsStream(t *testing.T) {
	var gotBody string
	store := newTestCOS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		w.WriteHeader(http.StatusOK)
	}))

	_, size, err := store.Save(context.Background(), nonSeekable{strings.NewReader("stream-body")}, "mp4")
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if size != int64(len("stream-body")) || gotBody != "stream-body" {
		t.Fatalf("size = %d body = %q, want %d stream-body", size, gotBody, len("stream-body"))
	}
}

// TestCOSDeleteIdempotent 删除缺失对象视为成功(404 NoSuchKey 不报错),真实错误才上抛。
func TestCOSDeleteIdempotent(t *testing.T) {
	cases := []struct {
		name    string
		status  int
		body    string
		wantErr bool
	}{
		{"deleted", http.StatusNoContent, "", false},
		{"missing", http.StatusNotFound, `<?xml version="1.0"?><Error><Code>NoSuchKey</Code></Error>`, false},
		{"denied", http.StatusForbidden, `<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newTestCOS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			err := store.Delete(context.Background(), "tmp/gone.png")
			if tc.wantErr && err == nil {
				t.Fatal("want error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("want nil, got %v", err)
			}
		})
	}
}

// TestCOSOpenNotFound Open 缺失对象映射为 os.ErrNotExist(内容端点据此返回 404)。
func TestCOSOpenNotFound(t *testing.T) {
	store := newTestCOS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`<?xml version="1.0"?><Error><Code>NoSuchKey</Code></Error>`))
	}))
	_, err := store.Open(context.Background(), "tmp/gone.png")
	if err == nil || !strings.Contains(err.Error(), os.ErrNotExist.Error()) {
		t.Fatalf("want os.ErrNotExist, got %v", err)
	}
}

// TestNewCOSDefaults 默认域名回退与前缀归一化(补尾部 /、去头部 /)。
func TestNewCOSDefaults(t *testing.T) {
	store, err := NewCOS(COSConfig{
		SecretID: "id", SecretKey: "key",
		Bucket: "my-assets-1250000000", Region: "ap-guangzhou",
		Prefix: "/cms",
	})
	if err != nil {
		t.Fatalf("new cos: %v", err)
	}
	if got := store.URL("cms/a.png"); got != "https://my-assets-1250000000.cos.ap-guangzhou.myqcloud.com/cms/a.png" {
		t.Fatalf("url = %q", got)
	}
	if store.prefix != "cms/" {
		t.Fatalf("prefix = %q, want cms/", store.prefix)
	}
	if store.Driver() != "cos" {
		t.Fatalf("driver = %q", store.Driver())
	}
}
