package repo

import "time"

// GORM 模型:表结构唯一事实源是这些模型(设计见 docs/database.md)。
// 阶段 1 建齐认证相关五张表(users + RBAC 四张),RBAC 的业务逻辑在阶段 2 接入。

// User 用户表。
type User struct {
	ID           int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	Username     string     `gorm:"size:64;uniqueIndex;not null" json:"username"`
	PasswordHash string     `gorm:"size:100;not null" json:"-"`
	Nickname     string     `gorm:"size:64" json:"nickname"`
	Email        string     `gorm:"size:128" json:"email"`
	Status       bool       `gorm:"not null" json:"status"`
	IsBuiltin    bool       `gorm:"not null;default:false" json:"isBuiltin"`
	LastLoginAt  *time.Time `json:"lastLoginAt"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

func (User) TableName() string { return "users" }

// Role 角色表。
type Role struct {
	ID        int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Code      string    `gorm:"size:64;uniqueIndex;not null" json:"code"`
	Name      string    `gorm:"size:64;not null" json:"name"`
	Remark    string    `gorm:"size:255" json:"remark"`
	Status    bool      `gorm:"not null" json:"status"`
	IsBuiltin bool      `gorm:"not null;default:false" json:"isBuiltin"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (Role) TableName() string { return "roles" }

// UserRole 用户 ↔ 角色关联表。
type UserRole struct {
	ID     int64 `gorm:"primaryKey;autoIncrement"`
	UserID int64 `gorm:"not null;uniqueIndex:uk_user_role;index"`
	RoleID int64 `gorm:"not null;uniqueIndex:uk_user_role;index"`
}

func (UserRole) TableName() string { return "user_roles" }

// Permission 权限点(menu / api 统一)。
type Permission struct {
	ID       int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	Code     string `gorm:"size:128;uniqueIndex;not null" json:"code"`
	Name     string `gorm:"size:64;not null" json:"name"`
	Type     string `gorm:"size:16;not null;index" json:"type"` // menu / api
	ParentID int64  `gorm:"not null;default:0" json:"parentId"`
	Sort     int    `gorm:"not null;default:0" json:"sort"`
	Timestamps
}

func (Permission) TableName() string { return "permissions" }

// RolePermission 角色 ↔ 权限关联表。
type RolePermission struct {
	ID           int64 `gorm:"primaryKey;autoIncrement"`
	RoleID       int64 `gorm:"not null;uniqueIndex:uk_role_permission;index"`
	PermissionID int64 `gorm:"not null;uniqueIndex:uk_role_permission;index"`
}

func (RolePermission) TableName() string { return "role_permissions" }

// Timestamps 可复用的创建/更新时间字段。
type Timestamps struct {
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// SysConfig 系统配置 KV(group + key 唯一)。
type SysConfig struct {
	ID        int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	Group     string `gorm:"size:32;not null;uniqueIndex:uk_config_group_key" json:"group"`
	Key       string `gorm:"size:64;not null;uniqueIndex:uk_config_group_key" json:"key"`
	Value     string `gorm:"type:text" json:"value"`
	Remark    string `gorm:"size:255" json:"remark"`
	UpdatedBy int64  `gorm:"not null;default:0" json:"updatedBy"`
	Timestamps
}

func (SysConfig) TableName() string { return "sys_configs" }

// Dict 字典。
type Dict struct {
	ID     int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	Code   string `gorm:"size:64;uniqueIndex;not null" json:"code"`
	Name   string `gorm:"size:64;not null" json:"name"`
	Remark string `gorm:"size:255" json:"remark"`
	Status bool   `gorm:"not null" json:"status"`
	Timestamps
}

func (Dict) TableName() string { return "dicts" }

// DictEntry 字典项;同字典内 value 唯一。
type DictEntry struct {
	ID     int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	DictID int64  `gorm:"not null;index;uniqueIndex:uk_dict_entry_value" json:"dictId"`
	Label  string `gorm:"size:64;not null" json:"label"`
	Value  string `gorm:"size:64;not null;uniqueIndex:uk_dict_entry_value" json:"value"`
	Sort   int    `gorm:"not null;default:0" json:"sort"`
	Status bool   `gorm:"not null" json:"status"`
	Timestamps
}

func (DictEntry) TableName() string { return "dict_items" }
