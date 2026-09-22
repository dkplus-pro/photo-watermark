package handler

import (
	"errors"
	"log/slog"
	"net/http"

	gen "github.com/cms-template/server/gen/admin"
	"github.com/cms-template/server/internal/httpapi"
	"github.com/cms-template/server/internal/service"
	"github.com/cms-template/server/internal/types"
)

// ConfigsHandler Configs资源处理器,只注入本资源所需依赖。
type ConfigsHandler struct {
	logger  *slog.Logger
	configs *service.ConfigService
}

func toGenConfigItem(item types.ConfigItem) gen.ConfigItem {
	return gen.ConfigItem{
		Key:    item.Key,
		Value:  item.Value,
		Remark: genOptsString(item.Remark),
	}
}

// toGenDict 领域模型 → 契约生成物。

func (h *ConfigsHandler) GetConfig(w http.ResponseWriter, r *http.Request, group gen.GetConfigParamsGroup) {
	items, err := h.configs.Get(r.Context(), string(group))
	switch {
	case errors.Is(err, service.ErrInvalidConfigGroup):
		httpapi.WriteError(w, http.StatusBadRequest, "非法配置组")
		return
	case err != nil:
		h.logger.Error("get config", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	list := make([]gen.ConfigItem, 0, len(items))
	for _, item := range items {
		list = append(list, toGenConfigItem(item))
	}
	httpapi.WriteJSON(w, http.StatusOK, gen.ConfigGroupResponse{Group: string(group), Items: list})
}

// UpdateConfig PUT /configs/{group}。

func (h *ConfigsHandler) UpdateConfig(w http.ResponseWriter, r *http.Request, group gen.UpdateConfigParamsGroup) {
	var req gen.ConfigUpdateRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}

	operatorID, _ := claimsUserID(r)
	items := make([]types.ConfigItem, 0, len(req.Items))
	for _, item := range req.Items {
		items = append(items, types.ConfigItem{Key: item.Key, Value: item.Value, Remark: derefString(item.Remark)})
	}

	if err := h.configs.Replace(r.Context(), string(group), items, operatorID); err != nil {
		if errors.Is(err, service.ErrInvalidConfigGroup) {
			httpapi.WriteError(w, http.StatusBadRequest, "非法配置组")
			return
		}
		h.logger.Error("update config", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusNoContent, nil)
}

// ListDicts GET /dicts。
