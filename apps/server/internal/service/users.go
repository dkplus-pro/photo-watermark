package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"

	"gorm.io/gorm"

	"github.com/cms-template/server/internal/oplog"
	"github.com/cms-template/server/internal/repo"
	"github.com/cms-template/server/internal/types"
)

// 用户模块业务错误。
var (
	ErrUsernameExists = errors.New("username exists")
	ErrSelfOperation  = errors.New("self operation")
	ErrBuiltinUser    = errors.New("builtin user")
)

// UserService 用户管理业务。
type UserService struct {
	db *gorm.DB
}

// NewUserService 装配 UserService。
func NewUserService(db *gorm.DB) *UserService {
	return &UserService{db: db}
}

// List 用户分页。
func (s *UserService) List(ctx context.Context, page, pageSize int, keyword string, status *bool) ([]types.UserItem, int64, error) {
	users, total, err := repo.ListUsers(ctx, s.db, page, pageSize, keyword, status)
	if err != nil {
		return nil, 0, err
	}

	items := make([]types.UserItem, 0, len(users))
	for _, user := range users {
		item, err := s.toUserItem(ctx, user)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, item)
	}
	return items, total, nil
}

// Get 用户详情。
func (s *UserService) Get(ctx context.Context, id int64) (types.UserItem, error) {
	user, err := repo.GetUserByID(ctx, s.db, id)
	if err != nil {
		return types.UserItem{}, translateRepoErr(err, repo.ErrUserNotFound, ErrUserNotFound)
	}
	return s.toUserItem(ctx, user)
}

// Create 新建用户:用户名唯一,bcrypt 加密,事务内绑定角色。
func (s *UserService) Create(ctx context.Context, username, password, nickname, email string, status bool, roleIDs []int64) (types.UserItem, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return types.UserItem{}, fmt.Errorf("hash password: %w", err)
	}

	user := repo.User{
		Username:     username,
		PasswordHash: string(hash),
		Nickname:     nickname,
		Email:        email,
		Status:       status,
	}
	if err := repo.CreateUser(ctx, s.db, &user, roleIDs); err != nil {
		if errors.Is(err, repo.ErrUsernameExists) {
			return types.UserItem{}, ErrUsernameExists
		}
		return types.UserItem{}, err
	}
	oplog.Success(ctx, s.db, oplog.Entry{
		Action: "user.create", Resource: "user", ResourceID: user.Username,
		Description: "创建用户 " + user.Nickname + "(" + user.Username + ")",
	}, "")
	return s.toUserItem(ctx, user)
}

// Update 编辑昵称/邮箱(记业务日志)。
func (s *UserService) Update(ctx context.Context, id int64, nickname, email string) (types.UserItem, error) {
	user, err := repo.GetUserByID(ctx, s.db, id)
	if err != nil {
		return types.UserItem{}, translateRepoErr(err, repo.ErrUserNotFound, ErrUserNotFound)
	}
	if err := repo.UpdateUserProfile(ctx, s.db, id, nickname, email); err != nil {
		return types.UserItem{}, err
	}
	oplog.Success(ctx, s.db, oplog.Entry{
		Action: "user.update", Resource: "user", ResourceID: user.Username,
		Description: "编辑用户 " + user.Nickname + "(" + user.Username + ")",
	}, "")
	return s.Get(ctx, id)
}

// UpdateStatus 启用/禁用;不可操作自己与内置管理员。
func (s *UserService) UpdateStatus(ctx context.Context, operatorID, id int64, status bool) error {
	if operatorID == id {
		return ErrSelfOperation
	}
	user, err := repo.GetUserByID(ctx, s.db, id)
	if err != nil {
		return translateRepoErr(err, repo.ErrUserNotFound, ErrUserNotFound)
	}
	if user.IsBuiltin {
		oplog.Failed(ctx, s.db, oplog.Entry{
			Action: "user.updateStatus", Resource: "user", ResourceID: user.Username,
			Description: "禁用/启用用户失败:内置管理员不可操作",
		}, "")
		return ErrBuiltinUser
	}
	if err := repo.UpdateUserStatus(ctx, s.db, id, status); err != nil {
		return err
	}
	verb := "启用"
	if !status {
		verb = "禁用"
	}
	oplog.Success(ctx, s.db, oplog.Entry{
		Action: "user.updateStatus", Resource: "user", ResourceID: user.Username,
		Description: verb + "用户 " + user.Nickname + "(" + user.Username + ")",
	}, "")
	return nil
}

// Delete 删除用户;不可操作自己与内置管理员。
func (s *UserService) Delete(ctx context.Context, operatorID, id int64) error {
	if operatorID == id {
		return ErrSelfOperation
	}
	user, err := repo.GetUserByID(ctx, s.db, id)
	if err != nil {
		return translateRepoErr(err, repo.ErrUserNotFound, ErrUserNotFound)
	}
	if user.IsBuiltin {
		oplog.Failed(ctx, s.db, oplog.Entry{
			Action: "user.delete", Resource: "user", ResourceID: user.Username,
			Description: "删除用户失败:内置管理员不可删除",
		}, "")
		return ErrBuiltinUser
	}
	if err := repo.DeleteUser(ctx, s.db, id); err != nil {
		return err
	}
	oplog.Success(ctx, s.db, oplog.Entry{
		Action: "user.delete", Resource: "user", ResourceID: user.Username,
		Description: "删除用户 " + user.Nickname + "(" + user.Username + ")",
	}, "")
	return nil
}

// UpdateRoles 分配角色(全量覆盖,记业务日志)。
func (s *UserService) UpdateRoles(ctx context.Context, id int64, roleIDs []int64) error {
	user, err := repo.GetUserByID(ctx, s.db, id)
	if err != nil {
		return translateRepoErr(err, repo.ErrUserNotFound, ErrUserNotFound)
	}
	if err := repo.ReplaceUserRoles(ctx, s.db, id, roleIDs); err != nil {
		return err
	}
	oplog.Success(ctx, s.db, oplog.Entry{
		Action: "user.assignRoles", Resource: "user", ResourceID: user.Username,
		Description: fmt.Sprintf("为用户 %s(%s) 分配 %d 个角色", user.Nickname, user.Username, len(roleIDs)),
	}, "")
	return nil
}

// PermissionCodes 供权限中间件加载用户权限码(经角色聚合)。
func (s *UserService) PermissionCodes(ctx context.Context, userID int64) ([]string, error) {
	return repo.ListPermissionCodesByUserID(ctx, s.db, userID)
}

func (s *UserService) toUserItem(ctx context.Context, user repo.User) (types.UserItem, error) {
	roleIDs, err := repo.ListRoleIDsByUserID(ctx, s.db, user.ID)
	if err != nil {
		return types.UserItem{}, err
	}
	var lastLoginAt *time.Time
	if user.LastLoginAt != nil {
		t := *user.LastLoginAt
		lastLoginAt = &t
	}
	return types.UserItem{
		ID:          user.ID,
		Username:    user.Username,
		Nickname:    user.Nickname,
		Email:       user.Email,
		Status:      user.Status,
		IsBuiltin:   user.IsBuiltin,
		LastLoginAt: lastLoginAt,
		RoleIds:     roleIDs,
	}, nil
}
