package repo

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
)

// ErrRoleNotFound 角色不存在。
var ErrRoleNotFound = errors.New("role not found")

// ListRoles 角色分页列表,keyword 模糊匹配 code/name。
func ListRoles(ctx context.Context, db *gorm.DB, page, pageSize int, keyword string, status *bool) ([]Role, int64, error) {
	query := db.WithContext(ctx).Model(&Role{})
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("code LIKE ? OR name LIKE ?", like, like)
	}
	if status != nil {
		query = query.Where("status = ?", *status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count roles: %w", err)
	}

	var roles []Role
	if err := query.Order("id ASC").
		Limit(pageSize).Offset((page - 1) * pageSize).
		Find(&roles).Error; err != nil {
		return nil, 0, fmt.Errorf("list roles: %w", err)
	}
	return roles, total, nil
}

// ListAllRoles 全量角色(下拉用),仅取启用列所需字段。
func ListAllRoles(ctx context.Context, db *gorm.DB) ([]Role, error) {
	var roles []Role
	if err := db.WithContext(ctx).Order("id ASC").Find(&roles).Error; err != nil {
		return nil, fmt.Errorf("list all roles: %w", err)
	}
	return roles, nil
}

// GetRoleByID 按主键查角色。
func GetRoleByID(ctx context.Context, db *gorm.DB, id int64) (Role, error) {
	var role Role
	err := db.WithContext(ctx).First(&role, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Role{}, ErrRoleNotFound
	}
	if err != nil {
		return Role{}, fmt.Errorf("get role by id: %w", err)
	}
	return role, nil
}

// GetRoleByCode 按编码查角色(唯一性校验)。
func GetRoleByCode(ctx context.Context, db *gorm.DB, code string) (Role, error) {
	var role Role
	err := db.WithContext(ctx).Where("code = ?", code).First(&role).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Role{}, ErrRoleNotFound
	}
	if err != nil {
		return Role{}, fmt.Errorf("get role by code: %w", err)
	}
	return role, nil
}

// CreateRole 新建角色。
func CreateRole(ctx context.Context, db *gorm.DB, role *Role) error {
	if err := db.WithContext(ctx).Create(role).Error; err != nil {
		return fmt.Errorf("create role: %w", err)
	}
	return nil
}

// UpdateRole 更新角色基础字段。
func UpdateRole(ctx context.Context, db *gorm.DB, role *Role) error {
	if err := db.WithContext(ctx).Save(role).Error; err != nil {
		return fmt.Errorf("update role: %w", err)
	}
	return nil
}

// DeleteRole 删除角色(含角色-权限关联;用户绑定守卫在 service 层)。
func DeleteRole(ctx context.Context, db *gorm.DB, roleID int64) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("role_id = ?", roleID).Delete(&RolePermission{}).Error; err != nil {
			return fmt.Errorf("clear role permissions: %w", err)
		}
		if err := tx.Delete(&Role{}, roleID).Error; err != nil {
			return fmt.Errorf("delete role: %w", err)
		}
		return nil
	})
}
