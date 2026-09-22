package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	appgen "github.com/cms-template/server/gen/app"
	"github.com/cms-template/server/internal/service"
)

// versionTestMux 起完整 mux 的公共装配:与 main.go 同款 HandlerFromMux 注册。
func versionTestMux(t *testing.T, cfg service.VersionServiceConfig) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	appgen.HandlerFromMux(New(nil, service.NewVersionService(cfg)), mux)
	return mux
}

// versionTestRequest 执行一次 GET /api/app/version/check 并返回响应。
func versionTestRequest(t *testing.T, mux *http.ServeMux, rawQuery string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/app/version/check?"+rawQuery, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// decodeVersionCheck 解析成功信封 data 载荷。
func decodeVersionCheck(t *testing.T, body []byte) (int, appgen.VersionCheckResult) {
	t.Helper()
	var envelope struct {
		Code    int                       `json:"code"`
		Message string                    `json:"message"`
		Data    appgen.VersionCheckResult `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	return envelope.Code, envelope.Data
}

// decodeVersionCheckError 解析错误信封(message)。
func decodeVersionCheckError(t *testing.T, body []byte) (int, string) {
	t.Helper()
	var envelope struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	return envelope.Code, envelope.Message
}

// TestVersionCheck H1/H4/H5:正常更新、非法版本降级、未配置回显。
func TestVersionCheck(t *testing.T) {
	mux := versionTestMux(t, service.VersionServiceConfig{
		IOS:     service.VersionRule{Latest: "1.4.0", DownloadURL: "https://example.com/app.ipa", ReleaseNotes: "iOS notes"},
		Android: service.VersionRule{Latest: "1.5.0", DownloadURL: "https://example.com/app.apk", ReleaseNotes: "Android notes"},
	})

	t.Run("H1 has update", func(t *testing.T) {
		rec := versionTestRequest(t, mux, "platform=ios&version=1.2.3")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
			t.Fatalf("Cache-Control = %q, want %q", cc, "no-store")
		}
		code, data := decodeVersionCheck(t, rec.Body.Bytes())
		if code != http.StatusOK {
			t.Fatalf("envelope code = %d, want %d", code, http.StatusOK)
		}
		if !data.HasUpdate || data.ForceUpdate {
			t.Fatalf("hasUpdate/forceUpdate = %v/%v, want true/false", data.HasUpdate, data.ForceUpdate)
		}
		if data.LatestVersion != "1.4.0" || data.DownloadUrl != "https://example.com/app.ipa" || data.ReleaseNotes != "iOS notes" {
			t.Fatalf("data = %+v", data)
		}
	})

	t.Run("H4 invalid version degrades to no update", func(t *testing.T) {
		rec := versionTestRequest(t, mux, "platform=ios&version=abc")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		code, data := decodeVersionCheck(t, rec.Body.Bytes())
		if code != http.StatusOK {
			t.Fatalf("envelope code = %d, want %d", code, http.StatusOK)
		}
		if data.HasUpdate || data.ForceUpdate {
			t.Fatalf("hasUpdate/forceUpdate = %v/%v, want false/false", data.HasUpdate, data.ForceUpdate)
		}
		if data.LatestVersion != "1.4.0" {
			t.Fatalf("latestVersion = %q, want configured %q", data.LatestVersion, "1.4.0")
		}
	})

	t.Run("H5 unconfigured platform echoes requested version", func(t *testing.T) {
		rec := versionTestRequest(t, versionTestMux(t, service.VersionServiceConfig{}), "platform=ios&version=1.2.3")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		_, data := decodeVersionCheck(t, rec.Body.Bytes())
		if data.HasUpdate || data.ForceUpdate {
			t.Fatalf("hasUpdate/forceUpdate = %v/%v, want false/false", data.HasUpdate, data.ForceUpdate)
		}
		if data.LatestVersion != "1.2.3" {
			t.Fatalf("latestVersion = %q, want echoed request version %q", data.LatestVersion, "1.2.3")
		}
	})
}

// TestVersionCheckPlatformValidation H2:非法平台映射 400 错误信封。
func TestVersionCheckPlatformValidation(t *testing.T) {
	mux := versionTestMux(t, service.VersionServiceConfig{IOS: service.VersionRule{Latest: "1.4.0"}})
	rec := versionTestRequest(t, mux, "platform=web&version=1.2.3")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	code, message := decodeVersionCheckError(t, rec.Body.Bytes())
	if code != http.StatusBadRequest || message != "platform 仅支持 ios/android" {
		t.Fatalf("envelope = %d/%q, want %d/%q", code, message, http.StatusBadRequest, "platform 仅支持 ios/android")
	}
}

// TestVersionCheckMissingVersion H3:version 缺失/空串 → 400(生成物对 required query 缺失已 400)。
func TestVersionCheckMissingVersion(t *testing.T) {
	mux := versionTestMux(t, service.VersionServiceConfig{IOS: service.VersionRule{Latest: "1.4.0"}})
	for name, rawQuery := range map[string]string{
		"missing version": "platform=ios",
		"empty version":   "platform=ios&version=",
	} {
		t.Run(name, func(t *testing.T) {
			rec := versionTestRequest(t, mux, rawQuery)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
			}
		})
	}
}

// TestVersionCheckForceBoundary H6:强制更新边界含等于。
func TestVersionCheckForceBoundary(t *testing.T) {
	mux := versionTestMux(t, service.VersionServiceConfig{
		IOS: service.VersionRule{Latest: "1.4.0", ForceBelow: "1.3.0"},
	})

	rec := versionTestRequest(t, mux, "platform=ios&version=1.2.3")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	_, below := decodeVersionCheck(t, rec.Body.Bytes())
	if !below.ForceUpdate || !below.HasUpdate {
		t.Fatalf("current < ForceBelow: hasUpdate/forceUpdate = %v/%v, want true/true", below.HasUpdate, below.ForceUpdate)
	}

	_, equal := decodeVersionCheck(t, versionTestRequest(t, mux, "platform=ios&version=1.3.0").Body.Bytes())
	if !equal.HasUpdate || equal.ForceUpdate {
		t.Fatalf("current == ForceBelow: hasUpdate/forceUpdate = %v/%v, want true/false", equal.HasUpdate, equal.ForceUpdate)
	}
}

// TestVersionCheckAndroidRules H7:platform=android 走 Android 规则。
func TestVersionCheckAndroidRules(t *testing.T) {
	mux := versionTestMux(t, service.VersionServiceConfig{
		IOS:     service.VersionRule{Latest: "1.4.0", DownloadURL: "https://example.com/app.ipa", ReleaseNotes: "iOS notes"},
		Android: service.VersionRule{Latest: "1.5.0", DownloadURL: "https://example.com/app.apk", ReleaseNotes: "Android notes"},
	})
	rec := versionTestRequest(t, mux, "platform=android&version=1.2.3")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	_, data := decodeVersionCheck(t, rec.Body.Bytes())
	if data.LatestVersion != "1.5.0" || data.DownloadUrl != "https://example.com/app.apk" || data.ReleaseNotes != "Android notes" {
		t.Fatalf("data = %+v, want Android rules", data)
	}
}
