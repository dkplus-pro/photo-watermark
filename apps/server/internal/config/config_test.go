package config

import (
	"testing"
)

// TestLoadAppVersionEnv C 端版本检查 env 解析:设置 8 个键 → 字段一一对应;
// 全部缺省 → 零值合法(空串,不报错)。
func TestLoadAppVersionEnv(t *testing.T) {
	t.Run("all keys set", func(t *testing.T) {
		t.Setenv("APP_VERSION_IOS", "1.4.0")
		t.Setenv("APP_FORCE_VERSION_IOS", "1.0.0")
		t.Setenv("APP_DOWNLOAD_URL_IOS", "https://example.com/app.ipa")
		t.Setenv("APP_RELEASE_NOTES_IOS", "iOS 更新说明")
		t.Setenv("APP_VERSION_ANDROID", "1.5.0")
		t.Setenv("APP_FORCE_VERSION_ANDROID", "1.1.0")
		t.Setenv("APP_DOWNLOAD_URL_ANDROID", "https://example.com/app.apk")
		t.Setenv("APP_RELEASE_NOTES_ANDROID", "Android 更新说明")

		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load() error = %v", err)
		}
		want := AppVersionConfig{
			IOS: AppVersionRuleConfig{
				LatestVersion:     "1.4.0",
				ForceBelowVersion: "1.0.0",
				DownloadURL:       "https://example.com/app.ipa",
				ReleaseNotes:      "iOS 更新说明",
			},
			Android: AppVersionRuleConfig{
				LatestVersion:     "1.5.0",
				ForceBelowVersion: "1.1.0",
				DownloadURL:       "https://example.com/app.apk",
				ReleaseNotes:      "Android 更新说明",
			},
		}
		if cfg.AppVersion != want {
			t.Fatalf("AppVersion = %+v, want %+v", cfg.AppVersion, want)
		}
	})

	t.Run("defaults are empty strings", func(t *testing.T) {
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load() error = %v", err)
		}
		want := AppVersionConfig{}
		if cfg.AppVersion != want {
			t.Fatalf("AppVersion = %+v, want zero value %+v", cfg.AppVersion, want)
		}
	})
}

func TestParseOrigins(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []string
	}{
		{name: "single origin", raw: "http://localhost:8081", want: []string{"http://localhost:8081"}},
		{
			name: "multiple origins",
			raw:  "https://admin.example.com,http://localhost:8081",
			want: []string{"https://admin.example.com", "http://localhost:8081"},
		},
		{name: "spaces around segments", raw: " https://a.example.com , https://b.example.com ", want: []string{"https://a.example.com", "https://b.example.com"}},
		{name: "empty segments ignored", raw: "https://a.example.com,,https://b.example.com", want: []string{"https://a.example.com", "https://b.example.com"}},
		{name: "trailing comma", raw: "https://a.example.com,", want: []string{"https://a.example.com"}},
		{name: "only spaces becomes empty", raw: "   ", want: []string{}},
		{name: "empty string becomes empty", raw: "", want: []string{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseOrigins(tt.raw)
			if len(got) != len(tt.want) {
				t.Fatalf("parseOrigins(%q) = %v, want %v", tt.raw, got, tt.want)
			}
			for i := range tt.want {
				if got[i] != tt.want[i] {
					t.Fatalf("parseOrigins(%q)[%d] = %q, want %q", tt.raw, i, got[i], tt.want[i])
				}
			}
		})
	}
}
