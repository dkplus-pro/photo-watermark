package app

import (
	"net/http"

	appgen "github.com/cms-template/server/gen/app"
	"github.com/cms-template/server/internal/httpapi"
)

// Ping GET /api/app/ping:联通性检查(占坑期 hello-world,匿名公开、禁止缓存)。
func (h *AppHandler) Ping(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	httpapi.WriteJSON(w, http.StatusOK, appgen.Ping{Message: "pong from app api"})
}
