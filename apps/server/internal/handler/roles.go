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

// RolesHandler Roles资源处理器,只注入本资源所需依赖。
type RolesHandler struct {
	logger *slog.Logger
	roles  *service.RoleService
}

// toGenRoleItem 领域模型 → 契约生成物。
func toGenRoleItem(item types.RoleItem) gen.RoleItem {
	var remark *string
	if item.Remark != "" {
		remark = &item.Remark
	}
	permissionIds := item.PermissionIds
	if permissionIds == nil {
		permissionIds = []int64{}
	}
	return gen.RoleItem{
		Id:            item.ID,
		Code:          item.Code,
		Name:          item.Name,
		Remark:        remark,
		Status:        item.Status,
		IsBuiltin:     item.IsBuiltin,
		PermissionIds: permissionIds,
	}
}

// ListRoles GET /roles。
func (h *RolesHandler) ListRoles(w http.ResponseWriter, r *http.Request, params gen.ListRolesParams) {
	page, pageSize := pageParams(params.Page, params.PageSize)
	keyword := derefString(params.Keyword)
	status := derefBool(params.Status)

	items, total, err := h.roles.List(r.Context(), page, pageSize, keyword, status)
	if err != nil {
		h.logger.Error("list roles", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	list := make([]gen.RoleItem, 0, len(items))
	for _, item := range items {
		list = append(list, toGenRoleItem(item))
	}
	httpapi.WriteJSON(w, http.StatusOK, gen.RoleListResponse{List: list, Total: int(total)})
}

// ListAllRoles GET /roles/all。
func (h *RolesHandler) ListAllRoles(w http.ResponseWriter, r *http.Request) {
	briefs, err := h.roles.All(r.Context())
	if err != nil {
		h.logger.Error("list all roles", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	list := make([]gen.RoleBrief, 0, len(briefs))
	for _, brief := range briefs {
		list = append(list, gen.RoleBrief{Id: brief.ID, Code: brief.Code, Name: brief.Name, Status: brief.Status})
	}
	httpapi.WriteJSON(w, http.StatusOK, list)
}

// CreateRole POST /roles。
func (h *RolesHandler) CreateRole(w http.ResponseWriter, r *http.Request) {
	var req gen.RoleRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}

	item, err := h.roles.Create(r.Context(), req.Code, req.Name, derefString(req.Remark), derefBoolDefault(req.Status, true))
	switch {
	case errors.Is(err, service.ErrRoleCodeExists):
		httpapi.WriteError(w, http.StatusConflict, "角色编码已存在")
		return
	case err != nil:
		h.logger.Error("create role", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toGenRoleItem(item))
}

// GetRole GET /roles/{id}。
func (h *RolesHandler) GetRole(w http.ResponseWriter, r *http.Request, id gen.Id) {
	item, err := h.roles.Get(r.Context(), int64(id))
	if err != nil {
		h.logger.Error("get role", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toGenRoleItem(item))
}

// UpdateRole PUT /roles/{id}。
func (h *RolesHandler) UpdateRole(w http.ResponseWriter, r *http.Request, id gen.Id) {
	var req gen.RoleRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}

	item, err := h.roles.Update(r.Context(), int64(id), req.Code, req.Name, derefString(req.Remark), derefBoolDefault(req.Status, true))
	switch {
	case errors.Is(err, service.ErrBuiltinRole):
		httpapi.WriteError(w, http.StatusForbidden, "内置角色不可修改编码")
		return
	case err != nil:
		h.logger.Error("update role", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusOK, toGenRoleItem(item))
}

// DeleteRole DELETE /roles/{id}。
func (h *RolesHandler) DeleteRole(w http.ResponseWriter, r *http.Request, id gen.Id) {
	err := h.roles.Delete(r.Context(), int64(id))
	switch {
	case errors.Is(err, service.ErrBuiltinRole):
		httpapi.WriteError(w, http.StatusForbidden, "内置角色不可删除")
		return
	case errors.Is(err, service.ErrRoleInUse):
		httpapi.WriteError(w, http.StatusConflict, "角色仍有用户绑定,请先解除")
		return
	case errors.Is(err, service.ErrRoleNotFound):
		httpapi.WriteError(w, http.StatusNotFound, "角色不存在")
		return
	case err != nil:
		h.logger.Error("delete role", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusNoContent, nil)
}

// UpdateRolePermissions PUT /roles/{id}/permissions。
func (h *RolesHandler) UpdateRolePermissions(w http.ResponseWriter, r *http.Request, id gen.Id) {
	var req gen.PermissionIdsRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}

	err := h.roles.UpdatePermissions(r.Context(), int64(id), req.PermissionIds)
	switch {
	case errors.Is(err, service.ErrPermissionInvalid):
		httpapi.WriteError(w, http.StatusBadRequest, "包含不存在的权限点")
		return
	case err != nil:
		h.logger.Error("update role permissions", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpapi.WriteJSON(w, http.StatusNoContent, nil)
}
