// Package types 内部领域模型:service 层的入参出参,不把生成物类型穿透到业务层。
package types

import "time"

// UserInfo 当前用户信息(登录与 /auth/me 共用)。
type UserInfo struct {
	ID          int64
	Username    string
	Nickname    string
	Email       string
	Status      bool
	Roles       []string
	Permissions []string
}

// UserItem 用户列表/详情条目。
type UserItem struct {
	ID          int64
	Username    string
	Nickname    string
	Email       string
	Status      bool
	IsBuiltin   bool
	LastLoginAt *time.Time
	RoleIds     []int64
}

// RoleItem 角色列表/详情条目。
type RoleItem struct {
	ID            int64
	Code          string
	Name          string
	Remark        string
	Status        bool
	IsBuiltin     bool
	PermissionIds []int64
}

// RoleBrief 角色简要信息(下拉用)。
type RoleBrief struct {
	ID     int64
	Code   string
	Name   string
	Status bool
}

// PermissionNode 权限点树节点。
type PermissionNode struct {
	ID       int64
	Code     string
	Name     string
	Type     string
	ParentID int64
	Children []PermissionNode
}

// OperationLogItem 业务操作日志条目(只读;字段语义见 docs/database.md)。
type OperationLogItem struct {
	ID          int64
	UserID      int64
	Username    string
	Action      string
	Resource    string
	ResourceID  string
	Description string
	Status      string
	IP          string
	CreatedAt   time.Time
}

// ConfigItem 配置键值条目。
type ConfigItem struct {
	Key    string
	Value  string
	Remark string
}

// Dict 字典。
type Dict struct {
	ID     int64
	Code   string
	Name   string
	Remark string
	Status bool
}

// DictEntry 字典项。
type DictEntry struct {
	ID     int64
	DictID int64
	Label  string
	Value  string
	Sort   int
	Status bool
}
