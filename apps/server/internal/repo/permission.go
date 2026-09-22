package repo

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UpsertPermission 按唯一键 code 幂等写入权限点,返回 ID。
func UpsertPermission(ctx context.Context, db *gorm.DB, permission *Permission) (int64, error) {
	if err := db.WithContext(ctx).
		Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "code"}}, DoNothing: true}).
		Create(permission).Error; err != nil {
		return 0, fmt.Errorf("upsert permission %s: %w", permission.Code, err)
	}
	var existing Permission
	if err := db.WithContext(ctx).Where("code = ?", permission.Code).First(&existing).Error; err != nil {
		return 0, fmt.Errorf("reload permission %s: %w", permission.Code, err)
	}
	return existing.ID, nil
}

// UpsertApiPermissions 把路由注册表中的 API 权限点同步进 permissions 表;
// 每个模块的 API 点挂在对应 menu 权限点之下(menu 点不存在则一并创建)。
func UpsertApiPermissions(ctx context.Context, db *gorm.DB, entries []ApiPermissionSeed) error {
	for _, entry := range entries {
		parentID := int64(0)
		if entry.ParentMenuCode != "" {
			menuID, err := UpsertPermission(ctx, db, &Permission{
				Code: entry.ParentMenuCode, Name: entry.ParentMenuName, Type: "menu",
			})
			if err != nil {
				return err
			}
			parentID = menuID
		}
		if _, err := UpsertPermission(ctx, db, &Permission{
			Code:     entry.Code,
			Name:     entry.Name,
			Type:     "api",
			ParentID: parentID,
		}); err != nil {
			return err
		}
	}
	return nil
}

// ApiPermissionSeed 路由注册表 → permissions 表的同步载荷。
type ApiPermissionSeed struct {
	Code           string
	Name           string
	ParentMenuCode string
	ParentMenuName string
}

// ListPermissions 全量权限点(按 type、code 排序,供组树)。
func ListPermissions(ctx context.Context, db *gorm.DB) ([]Permission, error) {
	var list []Permission
	if err := db.WithContext(ctx).
		Order("type ASC, code ASC").Find(&list).Error; err != nil {
		return nil, fmt.Errorf("list permissions: %w", err)
	}
	return list, nil
}

// ListPermissionIDsByRoleID 查角色拥有的权限点 ID。
func ListPermissionIDsByRoleID(ctx context.Context, db *gorm.DB, roleID int64) ([]int64, error) {
	var ids []int64
	if err := db.WithContext(ctx).Model(&RolePermission{}).
		Where("role_id = ?", roleID).Pluck("permission_id", &ids).Error; err != nil {
		return nil, fmt.Errorf("list permission ids by role: %w", err)
	}
	return ids, nil
}

// ErrPermissionNotFound 待分配的权限点不存在(校验在事务内执行,与写入原子)。
var ErrPermissionNotFound = errors.New("permission not found")

// ReplaceRolePermissions 全量覆盖角色的权限点:存在性校验与先删后插同一事务,
// 消除"校验通过后、写入前权限点被删"的 TOCTOU 窗口(见 apps/server/AGENTS.md §4)。
func ReplaceRolePermissions(ctx context.Context, db *gorm.DB, roleID int64, permissionIDs []int64) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if ids := slices.Compact(sortedCopy(permissionIDs)); len(ids) > 0 {
			var count int64
			if err := tx.Model(&Permission{}).Where("id IN ?", ids).Count(&count).Error; err != nil {
				return fmt.Errorf("count permissions: %w", err)
			}
			if count < int64(len(ids)) {
				return ErrPermissionNotFound
			}
		}
		if err := tx.Where("role_id = ?", roleID).Delete(&RolePermission{}).Error; err != nil {
			return fmt.Errorf("clear role permissions: %w", err)
		}
		for _, pid := range permissionIDs {
			rp := RolePermission{RoleID: roleID, PermissionID: pid}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rp).Error; err != nil {
				return fmt.Errorf("grant permission %d: %w", pid, err)
			}
		}
		return nil
	})
}

// CountUsersByRoleID 统计绑定某角色的用户数(删除角色前的守卫)。
func CountUsersByRoleID(ctx context.Context, db *gorm.DB, roleID int64) (int64, error) {
	var count int64
	if err := db.WithContext(ctx).Model(&UserRole{}).
		Where("role_id = ?", roleID).Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count users by role: %w", err)
	}
	return count, nil
}

// PrunePermissions 按注册表对账清理权限点:注册表是 api/menu 权限点的唯一事实源,
// 从注册表移除的接口与模块,其权限点及角色授予记录在启动时一并清除(自愈,防幽灵权限点)。
func PrunePermissions(ctx context.Context, db *gorm.DB, keepAPICodes, keepMenuCodes []string) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1. 清理已下线的 api 权限点。
		if err := prunePermissions(tx, "api", keepAPICodes); err != nil {
			return err
		}
		// 2. 清理已下线的菜单权限点(仍有 api 子点挂载的除外)。
		return pruneMenuPermissions(tx, keepMenuCodes)
	})
}

func prunePermissions(tx *gorm.DB, permissionType string, keepCodes []string) error {
	query := tx.Model(&Permission{}).Where("type = ?", permissionType)
	if len(keepCodes) > 0 {
		query = query.Where("code NOT IN ?", keepCodes)
	}
	var staleIDs []int64
	if err := query.Pluck("id", &staleIDs).Error; err != nil {
		return fmt.Errorf("find stale %s permissions: %w", permissionType, err)
	}
	if len(staleIDs) == 0 {
		return nil
	}
	if err := tx.Where("permission_id IN ?", staleIDs).Delete(&RolePermission{}).Error; err != nil {
		return fmt.Errorf("clear grants of stale %s permissions: %w", permissionType, err)
	}
	if err := tx.Where("id IN ?", staleIDs).Delete(&Permission{}).Error; err != nil {
		return fmt.Errorf("delete stale %s permissions: %w", permissionType, err)
	}
	return nil
}

func pruneMenuPermissions(tx *gorm.DB, keepMenuCodes []string) error {
	query := tx.Model(&Permission{}).Where("type = ?", "menu")
	if len(keepMenuCodes) > 0 {
		query = query.Where("code NOT IN ?", keepMenuCodes)
	}
	// 仍有 api 子点挂载的菜单点保留(其子点刚被对账保留,说明模块未下线)。
	query = query.Where("id NOT IN (SELECT parent_id FROM permissions WHERE type = 'api' AND parent_id != 0)")
	var staleIDs []int64
	if err := query.Pluck("id", &staleIDs).Error; err != nil {
		return fmt.Errorf("find stale menu permissions: %w", err)
	}
	if len(staleIDs) == 0 {
		return nil
	}
	if err := tx.Where("permission_id IN ?", staleIDs).Delete(&RolePermission{}).Error; err != nil {
		return fmt.Errorf("clear grants of stale menu permissions: %w", err)
	}
	if err := tx.Where("id IN ?", staleIDs).Delete(&Permission{}).Error; err != nil {
		return fmt.Errorf("delete stale menu permissions: %w", err)
	}
	return nil
}

// sortedCopy 返回升序去重副本(IN 计数比较用;Compact 需相邻去重,先排序)。
func sortedCopy(ids []int64) []int64 {
	out := slices.Clone(ids)
	slices.Sort(out)
	return out
}
