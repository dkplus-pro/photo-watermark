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

// AuthHandler Auth资源处理器,只注入本资源所需依赖。
type AuthHandler struct {
	logger *slog.Logger
	auth   *service.AuthService
}

// toGenUserInfo 领域模型 → 契约生成物,映射只发生在 handler 层。
func toGenUserInfo(info types.UserInfo) gen.UserInfo {
	var email *string
	if info.Email != "" {
		email = &info.Email
	}
	if info.Roles == nil {
		info.Roles = []string{}
	}
	if info.Permissions == nil {
		info.Permissions = []string{}
	}
	return gen.UserInfo{
		Id:          info.ID,
		Username:    info.Username,
		Nickname:    info.Nickname,
		Email:       email,
		Status:      info.Status,
		Roles:       info.Roles,
		Permissions: info.Permissions,
	}
}

// Login POST /auth/login。
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req gen.LoginRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}

	token, expiresAt, info, err := h.auth.Login(r.Context(), req.Username, req.Password)
	switch {
	case errors.Is(err, service.ErrInvalidCredentials):
		httpapi.WriteError(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	case errors.Is(err, service.ErrUserDisabled):
		httpapi.WriteError(w, http.StatusForbidden, "账号已被禁用")
		return
	case err != nil:
		h.logger.Error("login", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	httpapi.WriteJSON(w, http.StatusOK, gen.LoginResponse{
		Token:     token,
		ExpiresAt: expiresAt,
		User:      toGenUserInfo(info),
	})
}

// Logout POST /auth/logout。MVP 为无状态 JWT,登出由前端清 token,服务端仅确认。
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	httpapi.WriteJSON(w, http.StatusNoContent, nil)
}

// GetMe GET /auth/me。
func (h *AuthHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	claims, ok := httpapi.ClaimsFromContext(r.Context())
	if !ok {
		httpapi.WriteError(w, http.StatusUnauthorized, "未登录或凭证缺失")
		return
	}

	info, err := h.auth.Me(r.Context(), claims.UserID)
	if err != nil {
		if errors.Is(err, service.ErrUserNotFound) {
			httpapi.WriteError(w, http.StatusUnauthorized, "用户不存在")
			return
		}
		h.logger.Error("get me", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	httpapi.WriteJSON(w, http.StatusOK, toGenUserInfo(info))
}

// ChangePassword PUT /auth/password。
func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	claims, ok := httpapi.ClaimsFromContext(r.Context())
	if !ok {
		httpapi.WriteError(w, http.StatusUnauthorized, "未登录或凭证缺失")
		return
	}

	var req gen.ChangePasswordRequest
	if err := httpapi.DecodeRequest(r, &req); err != nil {
		httpapi.WriteError(w, http.StatusBadRequest, "参数错误")
		return
	}

	err := h.auth.ChangePassword(r.Context(), claims.UserID, req.OldPassword, req.NewPassword)
	switch {
	case errors.Is(err, service.ErrWrongOldPassword):
		httpapi.WriteError(w, http.StatusBadRequest, "旧密码错误")
		return
	case err != nil:
		h.logger.Error("change password", "error", err)
		httpapi.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	httpapi.WriteJSON(w, http.StatusNoContent, nil)
}
