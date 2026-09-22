// Package site 实现 openapi/site.yaml 生成的公开站 ServerInterface。
// 公开接口:无鉴权、只读,欢迎网关/CDN 缓存;只调 service 的查询方法,
// 返回 DTO 一律用本包对应的 sitegen 类型,不复用 admin 的生成物。
package site

import (
	"log/slog"

	sitegen "github.com/cms-template/server/gen/site"
	"github.com/cms-template/server/internal/service"
)

// SiteHandler 公开站点接口装配。
type SiteHandler struct {
	logger  *slog.Logger
	configs *service.ConfigService
}

// New 构造 SiteHandler。
func New(logger *slog.Logger, configs *service.ConfigService) *SiteHandler {
	return &SiteHandler{logger: logger, configs: configs}
}

// ensureSiteGen 编译期校验:SiteHandler 实现生成物的 ServerInterface。
var _ sitegen.ServerInterface = (*SiteHandler)(nil)
