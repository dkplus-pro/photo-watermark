package handler

import (
	"errors"
	"log/slog"
	"net/http"

	gen "github.com/cms-template/server/gen/admin"
	"github.com/cms-template/server/internal/httpapi"
	"github.com/cms-template/server/internal/media"
)

// MediaGroupHandler MediaGroup资源处理器,只注入本资源所需依赖。
type MediaGroupHandler struct {
	logger *slog.Logger
	media  *media.Service
}

// 媒体分组:图片/视频共用能力,handler 按 kind 分派(契约见 openapi/admin.yaml 阶段 13)。

func toGenMediaGroup(group media.Group) gen.MediaGroup {
	return gen.MediaGroup{
		Id:         group.ID,
		Kind:       gen.MediaGroupKind(group.Kind),
		Name:       group.Name,
		MediaCount: int(group.MediaCount),
		CreatedAt:  group.CreatedAt,
	}
}

// ListMediaGroups GET /media-groups?kind=image|video。
func (h *MediaGroupHandler) ListMediaGroups(w http.ResponseWriter, r *http.Request, params gen.ListMediaGroupsParams) {
	groups, err := h.media.ListGroups(r.Context(), string(params.Kind))
	switch {
	case errors.Is(err, media.ErrInvalidType):
		httpapi.WriteError(w, http.StatusBadRequest, "不支持的媒体类型")
		return
	case err != nil:
		h.logger.Error("list media groups", "kind", params.Kind, "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	list := make([]gen.MediaGroup, 0, len(groups))
	for _, group := range groups {
		list = append(list, toGenMediaGroup(group))
	}
	httpapi.WriteJSON(w, http.StatusOK, gen.MediaGroupListResponse{List: list, Total: len(list)})
}

// CreateMediaGroup POST /media-groups。
func (h *MediaGroupHandler) CreateMediaGroup(w http.ResponseWriter, r *http.Request) {
	var req gen.CreateMediaGroupRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}
	group, err := h.media.CreateGroup(r.Context(), string(req.Kind), req.Name)
	switch {
	case errors.Is(err, media.ErrGroupNameExists):
		httpapi.WriteError(w, http.StatusConflict, "同类型下分组名已存在")
		return
	case errors.Is(err, media.ErrInvalidType), errors.Is(err, media.ErrInvalidGroupName):
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	case err != nil:
		h.logger.Error("create media group", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toGenMediaGroup(group))
}

// UpdateMediaGroup PUT /media-groups/{id}(重命名)。
func (h *MediaGroupHandler) UpdateMediaGroup(w http.ResponseWriter, r *http.Request, id gen.Id) {
	var req gen.UpdateMediaGroupRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}
	group, err := h.media.RenameGroup(r.Context(), int64(id), req.Name)
	switch {
	case errors.Is(err, media.ErrMediaGroupNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "分组不存在")
		return
	case errors.Is(err, media.ErrGroupNameExists):
		httpapi.WriteError(w, http.StatusConflict, "同类型下分组名已存在")
		return
	case errors.Is(err, media.ErrInvalidGroupName):
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	case err != nil:
		h.logger.Error("update media group", "id", id, "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toGenMediaGroup(group))
}

// DeleteMediaGroup DELETE /media-groups/{id}(组内资源移回未分组)。
func (h *MediaGroupHandler) DeleteMediaGroup(w http.ResponseWriter, r *http.Request, id gen.Id) {
	err := h.media.DeleteGroup(r.Context(), int64(id))
	switch {
	case errors.Is(err, media.ErrMediaGroupNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "分组不存在")
		return
	case err != nil:
		h.logger.Error("delete media group", "id", id, "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusNoContent, nil)
}

// MoveImageGroup PATCH /images/{id}/group。
func (h *MediaGroupHandler) MoveImageGroup(w http.ResponseWriter, r *http.Request, id gen.Id) {
	h.moveMediaGroup(w, r, media.KindImage, id)
}

// MoveVideoGroup PATCH /videos/{id}/group。
func (h *MediaGroupHandler) MoveVideoGroup(w http.ResponseWriter, r *http.Request, id gen.Id) {
	h.moveMediaGroup(w, r, media.KindVideo, id)
}

// moveMediaGroup 移动媒体资源分组(kind 决定资源类型与响应 schema)。
func (h *MediaGroupHandler) moveMediaGroup(w http.ResponseWriter, r *http.Request, kind string, id gen.Id) {
	var req gen.MediaGroupMoveRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}
	asset, err := h.media.MoveGroup(r.Context(), int64(id), req.GroupId)
	switch {
	case errors.Is(err, media.ErrMediaNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "资源不存在")
		return
	case errors.Is(err, media.ErrInvalidGroup):
		httpapi.WriteError(w, http.StatusBadRequest, "目标分组不存在或类型不匹配")
		return
	case err != nil:
		h.logger.Error("move media group", "kind", kind, "id", id, "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if kind == media.KindVideo {
		httpapi.WriteJSON(w, http.StatusOK, toGenVideo(asset))
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toGenImage(asset))
}
