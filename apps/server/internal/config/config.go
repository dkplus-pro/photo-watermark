// Package config 从环境变量加载服务配置,全部字段提供默认值,便于本地零配置启动。
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Config 服务运行所需的全量配置。
type Config struct {
	HTTP       HTTPConfig
	Database   DatabaseConfig
	Swagger    SwaggerConfig
	JWT        JWTConfig
	AccessLog  AccessLogConfig
	Storage    StorageConfig
	CSRF       CSRFConfig
	AppVersion AppVersionConfig
}

// AppVersionConfig C 端版本检查配置(公开只读;admin 配置页列后续阶段,见 docs/hybrid-capability-plan.md 决策 8)。
type AppVersionConfig struct {
	IOS     AppVersionRuleConfig
	Android AppVersionRuleConfig
}

// AppVersionRuleConfig 单平台版本规则;空 LatestVersion = 该平台未配置,检查恒返回无更新。
type AppVersionRuleConfig struct {
	LatestVersion     string
	ForceBelowVersion string
	DownloadURL       string
	ReleaseNotes      string
}

// CSRFConfig Origin 校验白名单配置(CSRF 纵深防御,见 docs/server.md "CSRF 与会话安全")。
type CSRFConfig struct {
	// AllowedOrigins 精确匹配的 Origin 白名单(带 scheme 与端口,形如 https://admin.example.com)。
	AllowedOrigins []string
}

// AccessLogConfig HTTP 访问日志文件配置(不入库,见 docs/database.md)。
type AccessLogConfig struct {
	Dir        string
	RetainDays int
}

// HTTPConfig HTTP 监听配置。
type HTTPConfig struct {
	// Addr 形如 ":8080"。
	Addr string
}

// DatabaseConfig 数据库配置,dev 默认 SQLite,生产切 MySQL(见 docs/database.md)。
type DatabaseConfig struct {
	// Driver 支持 "sqlite" / "mysql"。
	Driver string
	// DSN sqlite 为文件路径,mysql 为标准 DSN。
	DSN string
}

// SwaggerConfig Swagger UI 托管配置。
type SwaggerConfig struct {
	Enabled  bool
	SpecPath string
	// SiteSpecPath/AppSpecPath/H5SpecPath 其余受众契约路径;
	// 文件缺失时只跳过对应契约,不影响启动(admin 必需,读不到拒绝启动)。
	SiteSpecPath string
	AppSpecPath  string
	H5SpecPath   string
}

// JWTConfig 认证配置(见 docs/mvp-plan.md 认证约定)。
type JWTConfig struct {
	Secret string
	TTL    time.Duration
}

// StorageConfig 文件存储配置(多厂商,见 docs/mvp-plan.md 阶段 6)。
// 属运维项,改后重启生效;密钥只允许留在本地 .env.local(已 gitignore),不入库、不提交。
type StorageConfig struct {
	// Driver 存储驱动:"local" / "cos"。
	Driver string
	// BasePath local 专用:存储目录。
	BasePath string
	COS      COSConfig
}

// COSConfig 腾讯云 COS 配置(driver=cos 时 SecretID/SecretKey/Bucket/Region 必填)。
type COSConfig struct {
	SecretID  string
	SecretKey string
	// Bucket 全名,含 -APPID 后缀,如 my-assets-1250000000。
	Bucket string
	// Region 如 ap-guangzhou。
	Region string
	// CDNDomain CDN 域名;为空时用默认 https://{bucket}.cos.{region}.myqcloud.com。
	CDNDomain string
	// Prefix 对象 key 前缀,可空。
	Prefix string
}

// Load 读取环境变量并应用默认值,非法值直接报错,避免带病启动。
// 启动时先加载 .env.local 与 .env(若存在);已存在的环境变量优先,文件只补缺失项。
func Load() (Config, error) {
	// 忽略错误:文件本就允许不存在;.env.local 优先级高于 .env。
	_ = godotenv.Load(".env.local", ".env")

	cfg := Config{
		HTTP: HTTPConfig{
			Addr: ":" + envOr("SERVER_PORT", "8080"),
		},
		Database: DatabaseConfig{
			Driver: envOr("DATABASE_DRIVER", "sqlite"),
			DSN:    envOr("DATABASE_DSN", "data/cms.db"),
		},
		Swagger: SwaggerConfig{
			Enabled:      envBool("SWAGGER_ENABLED", true),
			SpecPath:     envOr("SWAGGER_SPEC_PATH", "../../openapi/admin.yaml"),
			SiteSpecPath: envOr("SWAGGER_SITE_SPEC_PATH", "../../openapi/site.yaml"),
			AppSpecPath:  envOr("SWAGGER_APP_SPEC_PATH", "../../openapi/app/openapi.yaml"),
			H5SpecPath:   envOr("SWAGGER_H5_SPEC_PATH", "../../openapi/h5/openapi.yaml"),
		},
		JWT: JWTConfig{
			Secret: envOr("JWT_SECRET", "dev-secret-change-me"),
			TTL:    time.Duration(envInt("JWT_TTL_HOURS", 2)) * time.Hour,
		},
		AccessLog: AccessLogConfig{
			Dir:        envOr("ACCESS_LOG_DIR", "logs"),
			RetainDays: envInt("ACCESS_LOG_RETAIN_DAYS", 7),
		},
		Storage: StorageConfig{
			Driver:   envOr("STORAGE_DRIVER", "local"),
			BasePath: envOr("STORAGE_BASE_PATH", "data/files"),
			COS: COSConfig{
				SecretID:  os.Getenv("COS_SECRET_ID"),
				SecretKey: os.Getenv("COS_SECRET_KEY"),
				Bucket:    os.Getenv("COS_BUCKET"),
				Region:    os.Getenv("COS_REGION"),
				CDNDomain: strings.TrimRight(os.Getenv("COS_CDN_DOMAIN"), "/"),
				Prefix:    os.Getenv("COS_PREFIX"),
			},
		},
		CSRF: CSRFConfig{
			// 默认 http://localhost:8081:dev 代理下 admin 的 Origin(开箱即用,
			// changeOrigin 只改 Host 不改 Origin);生产部署必须显式注入真实域名。
			AllowedOrigins: parseOrigins(envOr("CSRF_ALLOWED_ORIGINS", "http://localhost:8081")),
		},
		// server 进程 env 与 mobile dart-define APP_VERSION 不同进程,键名无冲突。
		AppVersion: AppVersionConfig{
			IOS: AppVersionRuleConfig{
				LatestVersion:     envOr("APP_VERSION_IOS", ""),
				ForceBelowVersion: envOr("APP_FORCE_VERSION_IOS", ""),
				DownloadURL:       envOr("APP_DOWNLOAD_URL_IOS", ""),
				ReleaseNotes:      envOr("APP_RELEASE_NOTES_IOS", ""),
			},
			Android: AppVersionRuleConfig{
				LatestVersion:     envOr("APP_VERSION_ANDROID", ""),
				ForceBelowVersion: envOr("APP_FORCE_VERSION_ANDROID", ""),
				DownloadURL:       envOr("APP_DOWNLOAD_URL_ANDROID", ""),
				ReleaseNotes:      envOr("APP_RELEASE_NOTES_ANDROID", ""),
			},
		},
	}

	switch cfg.Database.Driver {
	case "sqlite", "mysql":
	default:
		return Config{}, fmt.Errorf("unsupported DATABASE_DRIVER %q (want sqlite or mysql)", cfg.Database.Driver)
	}

	switch cfg.Storage.Driver {
	case "local":
	case "cos":
		if err := cfg.Storage.COS.validate(); err != nil {
			return Config{}, err
		}
	default:
		return Config{}, fmt.Errorf("unsupported STORAGE_DRIVER %q (want local or cos)", cfg.Storage.Driver)
	}

	return cfg, nil
}

// validate driver=cos 时的必填校验,缺项一次性报全。
func (c COSConfig) validate() error {
	missing := make([]string, 0, 4)
	if c.SecretID == "" {
		missing = append(missing, "COS_SECRET_ID")
	}
	if c.SecretKey == "" {
		missing = append(missing, "COS_SECRET_KEY")
	}
	if c.Bucket == "" {
		missing = append(missing, "COS_BUCKET")
	}
	if c.Region == "" {
		missing = append(missing, "COS_REGION")
	}
	if len(missing) > 0 {
		return fmt.Errorf("STORAGE_DRIVER=cos requires env: %s", strings.Join(missing, ", "))
	}
	return nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// parseOrigins 解析逗号分隔的 Origin 白名单:逐段 trim 空格、忽略空段(如 "a,,b" / "a, b")。
func parseOrigins(raw string) []string {
	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		if origin := strings.TrimSpace(part); origin != "" {
			origins = append(origins, origin)
		}
	}
	return origins
}

func envBool(key string, fallback bool) bool {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}
	return v
}

func envInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return v
}
