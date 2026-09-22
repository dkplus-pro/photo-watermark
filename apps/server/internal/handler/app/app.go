// Package app 实现 openapi/app/ 生成的 C 端应用(mobile/desktop/miniapp 共享)ServerInterface。
// 占坑期匿名公开、只读;version/check 经 VersionService 读 env 配置;C 端用户认证落地时在 main.go 装配处插入 JWTAuth 预留槽位。
package app

import (
	"log/slog"

	appgen "github.com/cms-template/server/gen/app"
	"github.com/cms-template/server/internal/service"
)

// AppHandler C 端应用(app)接口装配。
type AppHandler struct {
	logger   *slog.Logger
	versions *service.VersionService
}

// New 构造 AppHandler。
func New(logger *slog.Logger, versions *service.VersionService) *AppHandler {
	return &AppHandler{logger: logger, versions: versions}
}

// ensureAppGen 编译期校验:AppHandler 实现生成物的 ServerInterface。
var _ appgen.ServerInterface = (*AppHandler)(nil)
