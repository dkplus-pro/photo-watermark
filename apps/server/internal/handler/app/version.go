package app

import (
	"net/http"
	"strings"

	appgen "github.com/cms-template/server/gen/app"
	"github.com/cms-template/server/internal/httpapi"
	"github.com/cms-template/server/internal/service"
)

// VersionCheck GET /api/app/version/check:版本检查(匿名公开、禁止缓存;查询接口不埋 oplog)。
func (h *AppHandler) VersionCheck(w http.ResponseWriter, r *http.Request, params appgen.VersionCheckParams) {
	platform, ok := service.ParseVersionPlatform(string(params.Platform))
	if !ok {
		httpapi.WriteError(w, http.StatusBadRequest, "platform 仅支持 ios/android")
		return
	}
	version := strings.TrimSpace(params.Version)
	if version == "" {
		httpapi.WriteError(w, http.StatusBadRequest, "version 不能为空")
		return
	}
	out := h.versions.Check(platform, version)
	w.Header().Set("Cache-Control", "no-store")
	httpapi.WriteJSON(w, http.StatusOK, appgen.VersionCheckResult{
		HasUpdate:     out.HasUpdate,
		ForceUpdate:   out.ForceUpdate,
		LatestVersion: out.LatestVersion,
		DownloadUrl:   out.DownloadURL,
		ReleaseNotes:  out.ReleaseNotes,
	})
}
