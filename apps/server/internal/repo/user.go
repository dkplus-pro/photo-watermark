package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// ErrUserNotFound 用户不存在。
var ErrUserNotFound = errors.New("user not found")

// GetUserByUsername 按登录名查用户。
func GetUserByUsername(ctx context.Context, db *gorm.DB, username string) (User, error) {
	var user User
	err := db.WithContext(ctx).Where("username = ?", username).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("get user by username: %w", err)
	}
	return user, nil
}

// GetUserByID 按主键查用户。
func GetUserByID(ctx context.Context, db *gorm.DB, id int64) (User, error) {
	var user User
	err := db.WithContext(ctx).First(&user, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("get user by id: %w", err)
	}
	return user, nil
}

// UpdateUserPassword 更新密码哈希。
func UpdateUserPassword(ctx context.Context, db *gorm.DB, userID int64, passwordHash string) error {
	if err := db.WithContext(ctx).Model(&User{}).Where("id = ?", userID).
		Update("password_hash", passwordHash).Error; err != nil {
		return fmt.Errorf("update user password: %w", err)
	}
	return nil
}

// UpdateUserLastLogin 记录最后登录时间。
func UpdateUserLastLogin(ctx context.Context, db *gorm.DB, userID int64, at time.Time) error {
	if err := db.WithContext(ctx).Model(&User{}).Where("id = ?", userID).
		Update("last_login_at", at).Error; err != nil {
		return fmt.Errorf("update user last login: %w", err)
	}
	return nil
}

// ListRoleCodesByUserID 查用户拥有的角色码。
func ListRoleCodesByUserID(ctx context.Context, db *gorm.DB, userID int64) ([]string, error) {
	var codes []string
	err := db.WithContext(ctx).Model(&Role{}).
		Joins("JOIN user_roles ON user_roles.role_id = roles.id").
		Where("user_roles.user_id = ? AND roles.status = ?", userID, true).
		Distinct().Pluck("roles.code", &codes).Error
	if err != nil {
		return nil, fmt.Errorf("list role codes: %w", err)
	}
	return codes, nil
}

// ListPermissionCodesByUserID 查用户拥有的权限码(经角色聚合)。
func ListPermissionCodesByUserID(ctx context.Context, db *gorm.DB, userID int64) ([]string, error) {
	var codes []string
	err := db.WithContext(ctx).Model(&Permission{}).
		Joins("JOIN role_permissions ON role_permissions.permission_id = permissions.id").
		Joins("JOIN user_roles ON user_roles.role_id = role_permissions.role_id").
		Where("user_roles.user_id = ?", userID).
		Distinct().Pluck("permissions.code", &codes).Error
	if err != nil {
		return nil, fmt.Errorf("list permission codes: %w", err)
	}
	return codes, nil
}
