package repo

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ListUsers 用户分页列表,keyword 模糊匹配 username/nickname。
func ListUsers(ctx context.Context, db *gorm.DB, page, pageSize int, keyword string, status *bool) ([]User, int64, error) {
	query := db.WithContext(ctx).Model(&User{})
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("username LIKE ? OR nickname LIKE ?", like, like)
	}
	if status != nil {
		query = query.Where("status = ?", *status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count users: %w", err)
	}

	var users []User
	if err := query.Order("id ASC").
		Limit(pageSize).Offset((page - 1) * pageSize).
		Find(&users).Error; err != nil {
		return nil, 0, fmt.Errorf("list users: %w", err)
	}
	return users, total, nil
}

// ErrUsernameExists 用户名已存在(事务内查重,与写入原子,消除 TOCTOU)。
var ErrUsernameExists = errors.New("username exists")

// CreateUser 新建用户(含角色绑定,事务内完成;用户名查重与写入同事务)。
func CreateUser(ctx context.Context, db *gorm.DB, user *User, roleIDs []int64) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&User{}).Where("username = ?", user.Username).Count(&count).Error; err != nil {
			return fmt.Errorf("check username: %w", err)
		}
		if count > 0 {
			return ErrUsernameExists
		}
		if err := tx.Create(user).Error; err != nil {
			return fmt.Errorf("create user: %w", err)
		}
		return replaceUserRoles(tx, user.ID, roleIDs)
	})
}

// UpdateUserProfile 更新昵称/邮箱。
func UpdateUserProfile(ctx context.Context, db *gorm.DB, userID int64, nickname, email string) error {
	if err := db.WithContext(ctx).Model(&User{}).Where("id = ?", userID).
		Updates(map[string]any{"nickname": nickname, "email": email}).Error; err != nil {
		return fmt.Errorf("update user profile: %w", err)
	}
	return nil
}

// UpdateUserStatus 启用/禁用用户。
func UpdateUserStatus(ctx context.Context, db *gorm.DB, userID int64, status bool) error {
	if err := db.WithContext(ctx).Model(&User{}).Where("id = ?", userID).
		Update("status", status).Error; err != nil {
		return fmt.Errorf("update user status: %w", err)
	}
	return nil
}

// DeleteUser 删除用户(含角色绑定,事务内完成)。
func DeleteUser(ctx context.Context, db *gorm.DB, userID int64) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userID).Delete(&UserRole{}).Error; err != nil {
			return fmt.Errorf("clear user roles: %w", err)
		}
		if err := tx.Delete(&User{}, userID).Error; err != nil {
			return fmt.Errorf("delete user: %w", err)
		}
		return nil
	})
}

// ListRoleIDsByUserID 查用户绑定的角色 ID。
func ListRoleIDsByUserID(ctx context.Context, db *gorm.DB, userID int64) ([]int64, error) {
	var ids []int64
	if err := db.WithContext(ctx).Model(&UserRole{}).
		Where("user_id = ?", userID).Pluck("role_id", &ids).Error; err != nil {
		return nil, fmt.Errorf("list role ids by user: %w", err)
	}
	return ids, nil
}

// ReplaceUserRoles 全量覆盖用户的角色绑定(事务内先删后插)。
func ReplaceUserRoles(ctx context.Context, db *gorm.DB, userID int64, roleIDs []int64) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return replaceUserRoles(tx, userID, roleIDs)
	})
}

func replaceUserRoles(tx *gorm.DB, userID int64, roleIDs []int64) error {
	if err := tx.Where("user_id = ?", userID).Delete(&UserRole{}).Error; err != nil {
		return fmt.Errorf("clear user roles: %w", err)
	}
	for _, rid := range roleIDs {
		ur := UserRole{UserID: userID, RoleID: rid}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&ur).Error; err != nil {
			return fmt.Errorf("grant role %d: %w", rid, err)
		}
	}
	return nil
}
