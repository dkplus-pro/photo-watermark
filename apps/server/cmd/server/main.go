// main 只做装配:读配置 → 连数据库 → 挂路由与中间件 → 启动监听。
// 业务逻辑在 internal/handler 与 internal/service,不要在这里堆业务代码;
// 启动期副任务(权限同步对账等)在 bootstrap.go。
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"syscall"
	"time"

	gen "github.com/cms-template/server/gen/admin"
	appgen "github.com/cms-template/server/gen/app"
	h5gen "github.com/cms-template/server/gen/h5"
	sitegen "github.com/cms-template/server/gen/site"
	"github.com/cms-template/server/internal/config"
	"github.com/cms-template/server/internal/handler"
	apphandler "github.com/cms-template/server/internal/handler/app"
	h5handler "github.com/cms-template/server/internal/handler/h5"
	sitehandler "github.com/cms-template/server/internal/handler/site"
	"github.com/cms-template/server/internal/httpapi"
	"github.com/cms-template/server/internal/media"
	"github.com/cms-template/server/internal/repo"
	"github.com/cms-template/server/internal/service"
	"github.com/cms-template/server/internal/storage"
	"github.com/cms-template/server/internal/uploads"
)

func main() {
	// os.Exit 只在这一层:run 内全部走 error 返回,defer 保证生效(如访问日志刷盘)。
	if err := run(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	// 访问日志双轨:stdout + 按天滚动文件,过期自动清理;业务日志另见 internal/oplog。
	accessLogger, closeAccessLog, err := httpapi.NewAccessLogger(
		cfg.AccessLog.Dir, "server", cfg.AccessLog.RetainDays)
	if err != nil {
		return fmt.Errorf("init access log: %w", err)
	}
	defer closeAccessLog()
	logger := accessLogger

	ctx := context.Background()

	db, err := repo.Open(repo.DatabaseConfig{Driver: cfg.Database.Driver, DSN: cfg.Database.DSN})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	if err := repo.AutoMigrate(ctx, db); err != nil {
		return fmt.Errorf("auto migrate: %w", err)
	}
	if err := repo.SeedAdmin(ctx, db); err != nil {
		return fmt.Errorf("seed admin: %w", err)
	}
	if err := bootstrapPermissions(ctx, db, logger); err != nil {
		return err
	}
	if err := repo.SeedSuperAdminRole(ctx, db); err != nil {
		return fmt.Errorf("seed super admin role: %w", err)
	}
	if err := repo.SeedConfigs(ctx, db); err != nil {
		return fmt.Errorf("seed configs: %w", err)
	}
	if err := repo.SeedDicts(ctx, db); err != nil {
		return fmt.Errorf("seed dicts: %w", err)
	}

	// 文件存储装配:多厂商抽象(见 docs/mvp-plan.md 阶段 6),切换驱动 = 改 STORAGE_DRIVER + 重启。
	var fileStorage storage.Storage
	switch cfg.Storage.Driver {
	case "cos":
		fileStorage, err = storage.NewCOS(storage.COSConfig{
			SecretID:  cfg.Storage.COS.SecretID,
			SecretKey: cfg.Storage.COS.SecretKey,
			Bucket:    cfg.Storage.COS.Bucket,
			Region:    cfg.Storage.COS.Region,
			CDNDomain: cfg.Storage.COS.CDNDomain,
			Prefix:    cfg.Storage.COS.Prefix,
		})
	default:
		fileStorage, err = storage.NewLocal(cfg.Storage.BasePath)
	}
	if err != nil {
		logger.Error("init file storage", "driver", cfg.Storage.Driver, "error", err)
		return fmt.Errorf("init file storage: %w", err)
	}
	logger.Info("file storage ready", "driver", fileStorage.Driver())
	mediaService := media.NewService(db, fileStorage)
	uploadsService := uploads.NewService(uploads.DefaultBaseDir, mediaService)

	// 多受众路由(见 docs/multi-audience-contracts.md 与 docs/mvp-plan.md 阶段 8):
	// URL 布局:admin 契约路径字面带 /api/admin、site 契约带 /api/site、app 契约带 /api/app、
	// h5 契约带 /api/h5,网关仅按前缀转发。
	authService := service.NewAuthService(db, cfg.JWT.Secret, cfg.JWT.TTL)
	usersService := service.NewUserService(db)
	rolesService := service.NewRoleService(db)
	permissionsService := service.NewPermissionService(db)
	logsService := service.NewLogService(db)
	configsService := service.NewConfigService(db)
	dictsService := service.NewDictService(db)

	jwtSkip := httpapi.JWTSkipPaths("/api/admin/healthz", "/api/admin/auth/login")
	loadPermissionCodes := func(ctx context.Context, userID int64) ([]string, error) {
		return usersService.PermissionCodes(ctx, userID)
	}

	adminMux := http.NewServeMux()
	gen.HandlerFromMux(handler.New(logger, authService, usersService, rolesService, permissionsService, logsService, configsService, dictsService, mediaService, uploadsService), adminMux)

	siteMux := http.NewServeMux()
	sitegen.HandlerFromMux(sitehandler.New(logger, configsService), siteMux)

	// app 受众:version/check 注入 env 版本配置服务(其余端点仍无 service);h5 维持纯匿名公开链。
	versionService := service.NewVersionService(service.VersionServiceConfig{
		IOS: service.VersionRule{
			Latest: cfg.AppVersion.IOS.LatestVersion, ForceBelow: cfg.AppVersion.IOS.ForceBelowVersion,
			DownloadURL: cfg.AppVersion.IOS.DownloadURL, ReleaseNotes: cfg.AppVersion.IOS.ReleaseNotes,
		},
		Android: service.VersionRule{
			Latest: cfg.AppVersion.Android.LatestVersion, ForceBelow: cfg.AppVersion.Android.ForceBelowVersion,
			DownloadURL: cfg.AppVersion.Android.DownloadURL, ReleaseNotes: cfg.AppVersion.Android.ReleaseNotes,
		},
	})
	appMux := http.NewServeMux()
	appgen.HandlerFromMux(apphandler.New(logger, versionService), appMux)

	h5Mux := http.NewServeMux()
	h5gen.HandlerFromMux(h5handler.New(logger), h5Mux)

	mux := http.NewServeMux()
	httpapi.RegisterSwagger(mux, logger, httpapi.SwaggerOptions{
		Enabled: cfg.Swagger.Enabled,
		Specs: []httpapi.SwaggerSpec{
			{Name: "admin", Path: cfg.Swagger.SpecPath, Required: true},
			{Name: "site", Path: cfg.Swagger.SiteSpecPath},
			{Name: "app", Path: cfg.Swagger.AppSpecPath},
			{Name: "h5", Path: cfg.Swagger.H5SpecPath},
		},
	})

	// 受众表驱动注册:新增受众 = 契约 + oapi cfg + gen + handler 子包 + 本表一条
	// (完整步骤见 apps/server/AGENTS.md §2),公开基链复用,不复制中间件代码。
	// 安全响应头各链都挂;Origin 校验只挂 admin 链(在 JWTAuth 之前,见 docs/server.md
	// "CSRF 与会话安全");Recover 恒为最后一环,保证后续中间件的 panic 不漏恢复。
	type audience struct {
		prefix  string
		handler http.Handler
		extras  []httpapi.Middleware
	}
	baseChain := []httpapi.Middleware{
		httpapi.RequestID(),
		httpapi.ClientIP(),
		httpapi.SecurityHeaders(),
		httpapi.Logging(logger),
	}
	audiences := []audience{
		{prefix: "/api/site/", handler: siteMux},
		{prefix: "/api/app/", handler: appMux},
		{prefix: "/api/h5/", handler: h5Mux},
		{prefix: "/api/admin/", handler: adminMux, extras: []httpapi.Middleware{
			httpapi.OriginCheck(cfg.CSRF.AllowedOrigins, logger),
			httpapi.JWTAuth(logger, cfg.JWT.Secret, jwtSkip),
			httpapi.PermissionCheck(loadPermissionCodes, logger),
		}},
	}
	for _, a := range audiences {
		chain := append(slices.Clone(baseChain), a.extras...)
		chain = append(chain, httpapi.Recover(logger))
		mux.Handle(a.prefix, httpapi.Chain(a.handler, chain...))
	}

	srv := &http.Server{
		Addr:              cfg.HTTP.Addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// 分片上传会话清理:启动清一轮 + 每小时定时,随进程退出停止(内部自旋,无需再 go)。
	uploadsService.StartCleaner(ctx, logger)

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("server listening", "addr", cfg.HTTP.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- fmt.Errorf("listen and serve: %w", err)
		}
	}()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
	}
	logger.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown", "error", err)
	}
	return nil
}
