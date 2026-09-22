// Package handler 实现 openapi/admin.yaml 生成的 admin ServerInterface。
// 每个资源一个文件、一个 per-resource struct(只注入本资源所需依赖);
// 本文件只做组合装配:各资源 struct 内嵌提升方法,满足契约接口。
package handler

import (
	"log/slog"

	gen "github.com/cms-template/server/gen/admin"
	"github.com/cms-template/server/internal/media"
	"github.com/cms-template/server/internal/service"
	"github.com/cms-template/server/internal/uploads"
)

// Handler 承载全部 HTTP 处理器:按资源内嵌组合,方法提升后实现 gen.ServerInterface。
type Handler struct {
	*AuthHandler
	*UsersHandler
	*RolesHandler
	*PermissionsHandler
	*LogsHandler
	*ConfigsHandler
	*DictsHandler
	*MediaHandler
	*MediaGroupHandler
	*UploadsHandler
	*HealthzHandler
}

// New 装配 Handler(依赖通过构造函数注入)。
func New(
	logger *slog.Logger,
	auth *service.AuthService,
	users *service.UserService,
	roles *service.RoleService,
	permissions *service.PermissionService,
	logs *service.LogService,
	configs *service.ConfigService,
	dicts *service.DictService,
	media *media.Service,
	uploads *uploads.Service,
) *Handler {
	return &Handler{
		AuthHandler:        &AuthHandler{logger: logger, auth: auth},
		UsersHandler:       &UsersHandler{logger: logger, users: users},
		RolesHandler:       &RolesHandler{logger: logger, roles: roles},
		PermissionsHandler: &PermissionsHandler{logger: logger, permissions: permissions},
		LogsHandler:        &LogsHandler{logger: logger, logs: logs},
		ConfigsHandler:     &ConfigsHandler{logger: logger, configs: configs},
		DictsHandler:       &DictsHandler{logger: logger, dicts: dicts},
		MediaHandler:       &MediaHandler{logger: logger, media: media},
		MediaGroupHandler:  &MediaGroupHandler{logger: logger, media: media},
		UploadsHandler:     &UploadsHandler{logger: logger, uploads: uploads},
		HealthzHandler:     &HealthzHandler{},
	}
}

// 编译期保证 Handler 实现了契约生成的全部接口;新增接口后此处会立即报错。
var _ gen.ServerInterface = (*Handler)(nil)
