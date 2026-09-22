package handler

import (
	"net/http"

	gen "github.com/cms-template/server/gen/admin"
	"github.com/cms-template/server/internal/httpapi"
)

// HealthzHandler 健康探针处理器(无依赖)。
type HealthzHandler struct {
}

// Healthz GET /healthz。
func (h *HealthzHandler) Healthz(w http.ResponseWriter, r *http.Request) {
	httpapi.WriteJSON(w, http.StatusOK, gen.HealthzResponse{Status: "ok"})
}
