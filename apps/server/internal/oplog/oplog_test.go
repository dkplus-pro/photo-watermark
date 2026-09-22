package oplog

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/cms-template/server/internal/repo"
	"github.com/cms-template/server/internal/reqctx"
)

// newOplogDB sqlite :memory: 真库 + 全量迁移,setup 范式与 internal/service 测试一致。
func newOplogDB(t *testing.T) *gorm.DB {
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

func mustFirstLog(t *testing.T, db *gorm.DB) repo.OperationLog {
	t.Helper()
	var log repo.OperationLog
	if err := db.First(&log).Error; err != nil {
		t.Fatalf("query operation log: %v", err)
	}
	return log
}

func TestRecordPersistsAllFields(t *testing.T) {
	db := newOplogDB(t)
	ctx := reqctx.WithClientIP(
		reqctx.WithIdentity(context.Background(), reqctx.Identity{UserID: 7, Username: "alice"}),
		"192.0.2.10",
	)
	// 有身份时 username 取 identity,fallback 不生效。
	Record(ctx, db, Entry{
		Action: "user.delete", Resource: "user", ResourceID: "42",
		Description: "删除用户 张三(zhangsan)", Status: StatusSuccess,
	}, "fallback-name")

	got := mustFirstLog(t, db)
	if got.UserID != 7 || got.Username != "alice" {
		t.Fatalf("identity should win over fallback, got userID=%d username=%q", got.UserID, got.Username)
	}
	if got.Action != "user.delete" || got.Resource != "user" || got.ResourceID != "42" {
		t.Fatalf("action fields not persisted: %+v", got)
	}
	if got.Description != "删除用户 张三(zhangsan)" {
		t.Fatalf("description not persisted: %+v", got)
	}
	if got.Status != StatusSuccess {
		t.Fatalf("status not persisted: %+v", got)
	}
	if got.IP != "192.0.2.10" {
		t.Fatalf("client IP not persisted: %+v", got)
	}
	if got.CreatedAt.IsZero() {
		t.Fatalf("created_at should be set: %+v", got)
	}
}

func TestRecordWithoutIdentityUsesFallback(t *testing.T) {
	db := newOplogDB(t)
	// 无身份(如登录失败):userID=0,username 取 fallback;未注入 IP 则落空串。
	Record(context.Background(), db, Entry{
		Action: "auth.login", Resource: "auth", ResourceID: "admin",
		Description: "登录失败:密码错误", Status: StatusFailed,
	}, "admin")

	got := mustFirstLog(t, db)
	if got.UserID != 0 {
		t.Fatalf("expected zero userID without identity, got %d", got.UserID)
	}
	if got.Username != "admin" {
		t.Fatalf("expected fallback username, got %q", got.Username)
	}
	if got.Status != StatusFailed {
		t.Fatalf("expected status failed, got %q", got.Status)
	}
	if got.IP != "" {
		t.Fatalf("expected empty IP without client IP, got %q", got.IP)
	}
}

func TestSuccessAndFailedWrappers(t *testing.T) {
	db := newOplogDB(t)
	ctx := context.Background()
	Success(ctx, db, Entry{
		Action: "dict.update", Resource: "dict", ResourceID: "1",
		Description: "更新字典 性别",
	}, "admin")
	Failed(ctx, db, Entry{
		Action: "media.upload", Resource: "image", ResourceID: "2",
		Description: "上传图片 头像.png 失败:超过大小上限",
	}, "uploader")

	var logs []repo.OperationLog
	if err := db.Order("id ASC").Find(&logs).Error; err != nil {
		t.Fatalf("list logs: %v", err)
	}
	if len(logs) != 2 {
		t.Fatalf("expected 2 logs, got %d", len(logs))
	}
	if logs[0].Status != StatusSuccess {
		t.Fatalf("Success should persist status %q, got %q", StatusSuccess, logs[0].Status)
	}
	if logs[1].Status != StatusFailed {
		t.Fatalf("Failed should persist status %q, got %q", StatusFailed, logs[1].Status)
	}
}

func TestEmptyStatusDefaultsToSuccess(t *testing.T) {
	db := newOplogDB(t)
	Record(context.Background(), db, Entry{
		Action: "config.replace", Resource: "config", ResourceID: "system",
		Description: "替换系统配置组 system",
	}, "admin")

	got := mustFirstLog(t, db)
	if got.Status != StatusSuccess {
		t.Fatalf("empty status should default to %q, got %q", StatusSuccess, got.Status)
	}
}

func TestRecordFailureDoesNotPanic(t *testing.T) {
	// 故意不建表模拟故障:落库失败只打日志,不得 panic、不得影响业务返回(Record 无返回值即业务继续)。
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	ctx := reqctx.WithIdentity(context.Background(), reqctx.Identity{UserID: 1, Username: "admin"})
	Record(ctx, db, Entry{
		Action: "user.delete", Resource: "user", ResourceID: "1",
		Description: "删除用户 张三", Status: StatusSuccess,
	}, "")

	var count int64
	if err := db.Model(&repo.OperationLog{}).Count(&count).Error; err == nil && count != 0 {
		t.Fatalf("no row should be persisted when recording fails, got %d", count)
	}
}
