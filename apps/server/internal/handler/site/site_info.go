package site

import (
	"net/http"

	sitegen "github.com/cms-template/server/gen/site"
	"github.com/cms-template/server/internal/httpapi"
)

// GetSiteInfo GET /site/v1/site-info:站点公开信息(只读、无鉴权,允许缓存)。
// 数据来自 admin 的 system 配置组,按对外字段裁剪后以 sitegen 类型返回。
func (h *SiteHandler) GetSiteInfo(w http.ResponseWriter, r *http.Request) {
	items, err := h.configs.Get(r.Context(), "system")
	if err != nil {
		h.logger.Error("get site info", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	info := sitegen.SiteInfo{SiteName: "", LogoUrl: ""}
	for _, item := range items {
		switch item.Key {
		case "siteName":
			info.SiteName = item.Value
		case "logoUrl":
			info.LogoUrl = item.Value
		}
	}

	w.Header().Set("Cache-Control", "public, max-age=60")
	httpapi.WriteJSON(w, http.StatusOK, info)
}
