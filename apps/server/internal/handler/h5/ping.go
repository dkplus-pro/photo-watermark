package h5

import (
	"net/http"

	h5gen "github.com/cms-template/server/gen/h5"
	"github.com/cms-template/server/internal/httpapi"
)

// Ping GET /api/h5/ping:联通性检查(占坑期 hello-world,匿名公开、禁止缓存)。
func (h *H5Handler) Ping(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	httpapi.WriteJSON(w, http.StatusOK, h5gen.Ping{Message: "pong from h5 api"})
}
