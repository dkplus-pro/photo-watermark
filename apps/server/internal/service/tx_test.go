package service

// 事务行为测试:存在性校验与写入必须原子(消 TOCTOU,见 apps/server/AGENTS.md §4)。
// 边界覆盖:越界(不存在的权限点)、重复分配、部分失败不落库(非法状态迁移)、
// 重复用户名(零值/空库)。

import (
	"context"
	"errors"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/cms-template/server/internal/oplog"
	"github.com/cms-template/server/internal/repo"
)

func newTxTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := repo.AutoMigrate(context.Background(), db); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	return db
}

// mustSeedPermission 写入一个权限点并返回 ID。
func mustSeedPermission(t *testing.T, db *gorm.DB, code string) int64 {
	t.Helper()
	id, err := repo.UpsertPermission(context.Background(), db, &repo.Permission{
		Code: code, Name: code, Type: "api",
	})
	if err != nil {
		t.Fatalf("seed permission %s: %v", code, err)
	}
	return id
}

func rolePermissionCount(t *testing.T, db *gorm.DB, roleID int64) int64 {
	t.Helper()
	var count int64
	if err := db.Model(&repo.RolePermission{}).Where("role_id = ?", roleID).Count(&count).Error; err != nil {
		t.Fatalf("count role permissions: %v", err)
	}
	return count
}

func TestUpdatePermissionsRejectsUnknownAtomically(t *testing.T) {
	db := newTxTestDB(t)
	ctx := context.Background()
	roles := NewRoleService(db)

	role := repo.Role{Code: "op", Name: "运营"}
	if err := repo.CreateRole(ctx, db, &role); err != nil {
		t.Fatalf("create role: %v", err)
	}
	valid := mustSeedPermission(t, db, "system:user:list")

	// 越界:混入不存在的权限点 → 整体拒绝,不产生部分写入(消 TOCTOU 后校验与写入同事务)。
	err := roles.UpdatePermissions(ctx, role.ID, []int64{valid, 99999})
	if !errors.Is(err, ErrPermissionInvalid) {
		t.Fatalf("expected ErrPermissionInvalid, got %v", err)
	}
	if n := rolePermissionCount(t, db, role.ID); n != 0 {
		t.Fatalf("expected no partial grant, got %d rows", n)
	}

	// 合法分配后再覆盖:重复 ID 不计为越界,全量替换生效。
	if err := roles.UpdatePermissions(ctx, role.ID, []int64{valid, valid}); err != nil {
		t.Fatalf("assign duplicated ids: %v", err)
	}
	if n := rolePermissionCount(t, db, role.ID); n != 1 {
		t.Fatalf("expected 1 row after dedupe, got %d", n)
	}

	// 非法状态迁移:角色不存在。
	if err := roles.UpdatePermissions(ctx, 8888, []int64{valid}); !errors.Is(err, ErrRoleNotFound) {
		t.Fatalf("expected ErrRoleNotFound, got %v", err)
	}
}

func TestCreateUserDuplicateUsernameAtomic(t *testing.T) {
	db := newTxTestDB(t)
	ctx := context.Background()
	users := NewUserService(db)

	created, err := users.Create(ctx, "op1", "pass1234", "运营一号", "", true, nil)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	// 重复用户名:整体失败,不留任何角色绑定孤儿行。
	role := repo.Role{Code: "op", Name: "运营"}
	if err := repo.CreateRole(ctx, db, &role); err != nil {
		t.Fatalf("create role: %v", err)
	}
	if _, err := users.Create(ctx, "op1", "pass1234", "二号", "", true, []int64{role.ID}); !errors.Is(err, ErrUsernameExists) {
		t.Fatalf("expected ErrUsernameExists, got %v", err)
	}
	var bindings int64
	if err := db.Model(&repo.UserRole{}).Where("user_id = ?", created.ID).Count(&bindings).Error; err != nil {
		t.Fatalf("count bindings: %v", err)
	}
	if bindings != 0 {
		t.Fatalf("expected no bindings on first user, got %d", bindings)
	}
	var total int64
	if err := db.Model(&repo.User{}).Count(&total).Error; err != nil {
		t.Fatalf("count users: %v", err)
	}
	if total != 1 {
		t.Fatalf("expected exactly 1 user, got %d", total)
	}

	// 正常路径:角色绑定落库。
	if _, err := users.Create(ctx, "op2", "pass1234", "运营二号", "", true, []int64{role.ID}); err != nil {
		t.Fatalf("create second user: %v", err)
	}
}

// TestDictFailureOplogRecorded 失败埋点落库断言:写路径失败(dict 不存在)必须记 failed 日志
// (AGENTS.md §5:成功与失败都埋点;补齐 F11 缺口)。
func TestDictFailureOplogRecorded(t *testing.T) {
	db := newTxTestDB(t)
	ctx := context.Background()
	dicts := NewDictService(db)

	if err := dicts.Delete(ctx, 4242); !errors.Is(err, ErrDictNotFound) {
		t.Fatalf("expected ErrDictNotFound, got %v", err)
	}
	if _, err := dicts.UpdateEntry(ctx, 4242, "标签", "v", 0, true); !errors.Is(err, ErrDictEntryNotFound) {
		t.Fatalf("expected ErrDictEntryNotFound, got %v", err)
	}
	var failed int64
	if err := db.Model(&repo.OperationLog{}).
		Where("status = ? AND action IN ?", oplog.StatusFailed, []string{"dict.delete", "dictEntry.update"}).
		Count(&failed).Error; err != nil {
		t.Fatalf("count failed logs: %v", err)
	}
	if failed != 2 {
		t.Fatalf("expected 2 failed logs, got %d", failed)
	}
}
