package service

import (
	"testing"
)

// TestCompareVersions V1–V6:数字版本比较纯函数,六类边界(空值/零值/越界/非法状态迁移)。
func TestCompareVersions(t *testing.T) {
	tests := []struct {
		name    string
		current string
		latest  string
		want    int
		wantErr bool
	}{
		// V1 相等(缺段按 0 补齐)。
		{name: "equal full segments", current: "1.2.3", latest: "1.2.3", want: 0},
		{name: "equal missing segment zero-filled", current: "1.2", latest: "1.2.0", want: 0},
		// V2 current 更旧(次版本/修订位分别覆盖)。
		{name: "older minor", current: "1.2.3", latest: "1.4.0", want: -1},
		{name: "older patch", current: "1.2.3", latest: "1.2.4", want: -1},
		// V3 current 更新。
		{name: "newer", current: "1.5.0", latest: "1.4.0", want: 1},
		// V4 非法输入表。
		{name: "empty string", current: "", latest: "1.2.3", wantErr: true},
		{name: "non numeric", current: "abc", latest: "1.2.3", wantErr: true},
		{name: "empty segment", current: "1..2", latest: "1.2.3", wantErr: true},
		{name: "too many segments", current: "1.2.3.4", latest: "1.2.3", wantErr: true},
		{name: "alpha segment", current: "1.2.x", latest: "1.2.3", wantErr: true},
		{name: "single v prefix allowed", current: "v1.2", latest: "1.2.0", want: 0},
		// V5 前导零与 v 前缀。
		{name: "leading zeros with v prefix", current: "v01.02.003", latest: "1.2.3", want: 0},
		// V6 预发布/构建元数据非法。
		{name: "prerelease suffix", current: "1.2.3-rc.1", latest: "1.2.3", wantErr: true},
		{name: "build metadata suffix", current: "1.2.3+build5", latest: "1.2.3", wantErr: true},
		{name: "plus sign segment", current: "+1.2.3", latest: "1.2.3", wantErr: true},
		{name: "double v prefix", current: "vv1.2", latest: "1.2.0", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := CompareVersions(tt.current, tt.latest)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("CompareVersions(%q, %q) error = nil, want error", tt.current, tt.latest)
				}
				return
			}
			if err != nil {
				t.Fatalf("CompareVersions(%q, %q) error = %v", tt.current, tt.latest, err)
			}
			if got != tt.want {
				t.Fatalf("CompareVersions(%q, %q) = %d, want %d", tt.current, tt.latest, got, tt.want)
			}
		})
	}
}

// TestVersionServiceCheck V7–V11:Check 决策(降级不阻断,逐字段断言)。
func TestVersionServiceCheck(t *testing.T) {
	t.Run("V7 latest empty echoes current", func(t *testing.T) {
		svc := NewVersionService(VersionServiceConfig{
			IOS: VersionRule{DownloadURL: "https://example.com/ignored", ReleaseNotes: "ignored"},
		})
		out := svc.Check(VersionPlatformIOS, "1.2.3")
		if out.HasUpdate || out.ForceUpdate {
			t.Fatalf("HasUpdate/ForceUpdate = %v/%v, want false/false", out.HasUpdate, out.ForceUpdate)
		}
		if out.LatestVersion != "1.2.3" {
			t.Fatalf("LatestVersion = %q, want echoed current %q", out.LatestVersion, "1.2.3")
		}
		if out.DownloadURL != "" || out.ReleaseNotes != "" {
			t.Fatalf("zero outcome expected, got %+v", out)
		}
	})

	t.Run("V8 invalid current degrades to no update", func(t *testing.T) {
		svc := NewVersionService(VersionServiceConfig{
			IOS: VersionRule{Latest: "1.4.0", DownloadURL: "https://example.com/a", ReleaseNotes: "n"},
		})
		out := svc.Check(VersionPlatformIOS, "abc")
		if out.HasUpdate || out.ForceUpdate {
			t.Fatalf("HasUpdate/ForceUpdate = %v/%v, want false/false", out.HasUpdate, out.ForceUpdate)
		}
		if out.LatestVersion != "1.4.0" {
			t.Fatalf("LatestVersion = %q, want configured %q", out.LatestVersion, "1.4.0")
		}
	})

	t.Run("V9 has update without force rule", func(t *testing.T) {
		svc := NewVersionService(VersionServiceConfig{IOS: VersionRule{Latest: "1.4.0"}})
		out := svc.Check(VersionPlatformIOS, "1.2.3")
		if !out.HasUpdate {
			t.Fatal("HasUpdate = false, want true")
		}
		if out.ForceUpdate {
			t.Fatal("ForceUpdate = true, want false (ForceBelow empty)")
		}
		if out.LatestVersion != "1.4.0" {
			t.Fatalf("LatestVersion = %q, want %q", out.LatestVersion, "1.4.0")
		}
	})

	t.Run("V10 force below boundary includes equal", func(t *testing.T) {
		svc := NewVersionService(VersionServiceConfig{
			IOS: VersionRule{Latest: "1.4.0", ForceBelow: "1.0.0"},
		})
		if out := svc.Check(VersionPlatformIOS, "0.9.9"); !out.ForceUpdate {
			t.Fatalf("current < ForceBelow: ForceUpdate = false, want true (out=%+v)", out)
		}
		if out := svc.Check(VersionPlatformIOS, "1.0.0"); out.ForceUpdate {
			t.Fatalf("current == ForceBelow: ForceUpdate = true, want false (out=%+v)", out)
		}
	})

	t.Run("V11 platform rules and passthrough", func(t *testing.T) {
		svc := NewVersionService(VersionServiceConfig{
			IOS: VersionRule{
				Latest: "1.4.0", DownloadURL: "https://example.com/app.ipa", ReleaseNotes: "iOS notes",
			},
			Android: VersionRule{
				Latest: "1.5.0", DownloadURL: "https://example.com/app.apk", ReleaseNotes: "Android notes",
			},
		})
		ios := svc.Check(VersionPlatformIOS, "1.2.3")
		if ios.LatestVersion != "1.4.0" || ios.DownloadURL != "https://example.com/app.ipa" || ios.ReleaseNotes != "iOS notes" {
			t.Fatalf("iOS outcome = %+v", ios)
		}
		android := svc.Check(VersionPlatformAndroid, "1.2.3")
		if android.LatestVersion != "1.5.0" || android.DownloadURL != "https://example.com/app.apk" || android.ReleaseNotes != "Android notes" {
			t.Fatalf("Android outcome = %+v", android)
		}
	})
}

// TestParseVersionPlatform V12:平台字符串解析边界。
func TestParseVersionPlatform(t *testing.T) {
	tests := []struct {
		raw    string
		want   VersionPlatform
		wantOK bool
	}{
		{raw: "ios", want: VersionPlatformIOS, wantOK: true},
		{raw: "android", want: VersionPlatformAndroid, wantOK: true},
		{raw: "IOS", wantOK: false},
		{raw: "", wantOK: false},
		{raw: "web", wantOK: false},
	}

	for _, tt := range tests {
		t.Run(tt.raw, func(t *testing.T) {
			got, ok := ParseVersionPlatform(tt.raw)
			if ok != tt.wantOK {
				t.Fatalf("ParseVersionPlatform(%q) ok = %v, want %v", tt.raw, ok, tt.wantOK)
			}
			if ok && got != tt.want {
				t.Fatalf("ParseVersionPlatform(%q) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}
