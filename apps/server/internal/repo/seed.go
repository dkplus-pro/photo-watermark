package repo

import (
	"context"
	"errors"
	"fmt"

	"golang.org/x/crypto/bcrypt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 初始超级管理员账号与角色(本地与 e2e 默认口令,首次登录后应修改)。
const (
	SeedAdminUsername      = "admin"
	SeedAdminPassword      = "admin123"
	SeedSuperAdminRoleCode = "super_admin"
	SeedSuperAdminRoleName = "超级管理员"
)

// SeedAdmin 幂等种子:users 表为空时创建初始内置管理员;可重复执行。
func SeedAdmin(ctx context.Context, db *gorm.DB) error {
	var count int64
	if err := db.WithContext(ctx).Model(&User{}).Count(&count).Error; err != nil {
		return fmt.Errorf("count users: %w", err)
	}
	if count > 0 {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(SeedAdminPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash seed password: %w", err)
	}

	admin := User{
		Username:     SeedAdminUsername,
		PasswordHash: string(hash),
		Nickname:     "管理员",
		Status:       true,
		IsBuiltin:    true,
	}
	if err := db.WithContext(ctx).Create(&admin).Error; err != nil {
		return fmt.Errorf("create seed admin: %w", err)
	}
	return nil
}

// SeedSuperAdminRole 幂等种子:确保内置超级管理员角色存在、拥有全量权限点、并绑定初始管理员。
// 必须在 UpsertApiPermissions 之后调用,保证新注册的权限点也被授予超级管理员。
func SeedSuperAdminRole(ctx context.Context, db *gorm.DB) error {
	var role Role
	err := db.WithContext(ctx).Where("code = ?", SeedSuperAdminRoleCode).First(&role).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		role = Role{Code: SeedSuperAdminRoleCode, Name: SeedSuperAdminRoleName, Status: true, IsBuiltin: true}
		if err := db.WithContext(ctx).Create(&role).Error; err != nil {
			return fmt.Errorf("create super admin role: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("get super admin role: %w", err)
	}

	if !role.IsBuiltin || !role.Status {
		if err := db.WithContext(ctx).Model(&Role{}).Where("id = ?", role.ID).
			Updates(map[string]any{"is_builtin": true, "status": true}).Error; err != nil {
			return fmt.Errorf("repair super admin role: %w", err)
		}
	}

	var permissionIDs []int64
	if err := db.WithContext(ctx).Model(&Permission{}).Pluck("id", &permissionIDs).Error; err != nil {
		return fmt.Errorf("list all permission ids: %w", err)
	}
	if err := ReplaceRolePermissions(ctx, db, role.ID, permissionIDs); err != nil {
		return err
	}

	admin, err := GetUserByUsername(ctx, db, SeedAdminUsername)
	if err != nil {
		return fmt.Errorf("get seed admin: %w", err)
	}
	return ReplaceUserRoles(ctx, db, admin.ID, []int64{role.ID})
}

// SeedConfigs 幂等种子:初始站点配置(value 为原样字符串,结构化数据自行 JSON 编码)。
// 存储配置已迁环境变量(.env.local,见 docs/mvp-plan.md 阶段 6),不再入库。
func SeedConfigs(ctx context.Context, db *gorm.DB) error {
	seeds := []SysConfig{
		{Group: "system", Key: "siteName", Value: "CMS 管理后台", Remark: "站点名称"},
		{Group: "system", Key: "logoUrl", Value: "", Remark: "Logo 图片地址"},
	}
	for _, seed := range seeds {
		cfg := seed
		if err := db.WithContext(ctx).
			Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "group"}, {Name: "key"}}, DoNothing: true}).
			Create(&cfg).Error; err != nil {
			return fmt.Errorf("seed config %s.%s: %w", seed.Group, seed.Key, err)
		}
	}
	// 清理阶段 6 之前入库的 storage 配置组(自愈,幂等)。
	if err := db.WithContext(ctx).Where("`group` = ?", "storage").Delete(&SysConfig{}).Error; err != nil {
		return fmt.Errorf("prune legacy storage configs: %w", err)
	}
	return nil
}

// SeedDicts 幂等种子:通用状态字典及其字典项。
func SeedDicts(ctx context.Context, db *gorm.DB) error {
	if _, err := GetDictByCode(ctx, db, "common_status"); err == nil {
		return nil
	} else if !errors.Is(err, ErrDictNotFound) {
		return fmt.Errorf("check seed dict: %w", err)
	}

	dict := Dict{Code: "common_status", Name: "通用状态", Remark: "启用/禁用通用状态", Status: true}
	if err := CreateDict(ctx, db, &dict); err != nil {
		return err
	}
	entries := []DictEntry{
		{DictID: dict.ID, Label: "启用", Value: "1", Sort: 1, Status: true},
		{DictID: dict.ID, Label: "禁用", Value: "0", Sort: 2, Status: true},
	}
	for _, entry := range entries {
		if err := CreateDictEntry(ctx, db, &entry); err != nil {
			return err
		}
	}
	return nil
}
