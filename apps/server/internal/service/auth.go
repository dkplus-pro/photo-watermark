// Package service 承载业务规则:事务边界、领域校验都在这一层,不感知 HTTP 细节。
package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"

	"gorm.io/gorm"

	"github.com/cms-template/server/internal/auth"
	"github.com/cms-template/server/internal/oplog"
	"github.com/cms-template/server/internal/repo"
	"github.com/cms-template/server/internal/types"
)

// 业务哨兵错误:handler 层按 errors.Is 映射为 HTTP 状态码。
var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUserDisabled       = errors.New("user disabled")
	ErrWrongOldPassword   = errors.New("wrong old password")
)

// AuthService 认证与账号业务。
type AuthService struct {
	db     *gorm.DB
	secret string
	ttl    time.Duration
}

// NewAuthService 装配 AuthService。
func NewAuthService(db *gorm.DB, secret string, ttl time.Duration) *AuthService {
	return &AuthService{db: db, secret: secret, ttl: ttl}
}

// Login 校验账号密码,签发 JWT 并记录最后登录时间(含失败的业务日志)。
func (s *AuthService) Login(ctx context.Context, username, password string) (string, time.Time, types.UserInfo, error) {
	user, err := repo.GetUserByUsername(ctx, s.db, username)
	if err != nil {
		if errors.Is(err, repo.ErrUserNotFound) {
			oplog.Failed(ctx, s.db, oplog.Entry{
				Action: "auth.login", Resource: "user", ResourceID: username,
				Description: "登录失败(用户名或密码错误)",
			}, username)
			return "", time.Time{}, types.UserInfo{}, ErrInvalidCredentials
		}
		return "", time.Time{}, types.UserInfo{}, err
	}
	if !user.Status {
		oplog.Failed(ctx, s.db, oplog.Entry{
			Action: "auth.login", Resource: "user", ResourceID: username,
			Description: "登录失败:账号已被禁用",
		}, username)
		return "", time.Time{}, types.UserInfo{}, ErrUserDisabled
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		oplog.Failed(ctx, s.db, oplog.Entry{
			Action: "auth.login", Resource: "user", ResourceID: username,
			Description: "登录失败(用户名或密码错误)",
		}, username)
		return "", time.Time{}, types.UserInfo{}, ErrInvalidCredentials
	}

	token, expiresAt, err := auth.SignToken(s.secret, user.ID, user.Username, s.ttl)
	if err != nil {
		return "", time.Time{}, types.UserInfo{}, err
	}
	if err := repo.UpdateUserLastLogin(ctx, s.db, user.ID, time.Now()); err != nil {
		return "", time.Time{}, types.UserInfo{}, err
	}

	info, err := s.buildUserInfo(ctx, user)
	if err != nil {
		return "", time.Time{}, types.UserInfo{}, err
	}
	oplog.Success(ctx, s.db, oplog.Entry{
		Action: "auth.login", Resource: "user", ResourceID: username,
		Description: "登录成功",
	}, username)
	return token, expiresAt, info, nil
}

// Me 返回当前用户信息(含角色码与权限码)。
func (s *AuthService) Me(ctx context.Context, userID int64) (types.UserInfo, error) {
	user, err := repo.GetUserByID(ctx, s.db, userID)
	if err != nil {
		return types.UserInfo{}, translateRepoErr(err, repo.ErrUserNotFound, ErrUserNotFound)
	}
	return s.buildUserInfo(ctx, user)
}

// ChangePassword 校验旧密码后更新(记业务日志,含失败)。
func (s *AuthService) ChangePassword(ctx context.Context, userID int64, oldPassword, newPassword string) error {
	user, err := repo.GetUserByID(ctx, s.db, userID)
	if err != nil {
		return translateRepoErr(err, repo.ErrUserNotFound, ErrUserNotFound)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(oldPassword)); err != nil {
		oplog.Failed(ctx, s.db, oplog.Entry{
			Action: "user.changePassword", Resource: "user", ResourceID: user.Username,
			Description: "修改密码失败:旧密码错误",
		}, "")
		return ErrWrongOldPassword
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash new password: %w", err)
	}
	if err := repo.UpdateUserPassword(ctx, s.db, userID, string(hash)); err != nil {
		return err
	}
	oplog.Success(ctx, s.db, oplog.Entry{
		Action: "user.changePassword", Resource: "user", ResourceID: user.Username,
		Description: "修改密码",
	}, "")
	return nil
}

func (s *AuthService) buildUserInfo(ctx context.Context, user repo.User) (types.UserInfo, error) {
	roles, err := repo.ListRoleCodesByUserID(ctx, s.db, user.ID)
	if err != nil {
		return types.UserInfo{}, err
	}
	permissions, err := repo.ListPermissionCodesByUserID(ctx, s.db, user.ID)
	if err != nil {
		return types.UserInfo{}, err
	}
	return types.UserInfo{
		ID:          user.ID,
		Username:    user.Username,
		Nickname:    user.Nickname,
		Email:       user.Email,
		Status:      user.Status,
		Roles:       roles,
		Permissions: permissions,
	}, nil
}
