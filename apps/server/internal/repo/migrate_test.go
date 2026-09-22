package repo

import (
	"context"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// 旧版 operation_logs(阶段 4 修订前,HTTP 访问日志字段)。
type legacyOperationLog struct {
	ID         int64     `gorm:"primaryKey;autoIncrement"`
	UserID     int64     `gorm:"not null;default:0"`
	Username   string    `gorm:"size:64"`
	Method     string    `gorm:"size:8;not null"`
	Path       string    `gorm:"size:255;not null"`
	Action     string    `gorm:"size:64"`
	OK         bool      `gorm:"not null"`
	StatusCode int       `gorm:"not null"`
	Message    string    `gorm:"size:255"`
	IP         string    `gorm:"size:45"`
	LatencyMS  int64     `gorm:"not null;default:0"`
	CreatedAt  time.Time `gorm:"not null"`
}

func (legacyOperationLog) TableName() string { return "operation_logs" }

// 旧表存在时,AutoMigrate 应删表并按业务日志模型重建(SQLite 无法给旧表加 NOT NULL 列)。
func TestAutoMigrateRebuildsLegacyOperationLogs(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	legacy := legacyOperationLog{Username: "admin", Method: "GET", Path: "/x", OK: true, StatusCode: 200}
	if err := db.AutoMigrate(&legacyOperationLog{}); err != nil {
		t.Fatalf("create legacy table: %v", err)
	}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatalf("seed legacy row: %v", err)
	}

	ctx := context.Background()
	if err := AutoMigrate(ctx, db); err != nil {
		t.Fatalf("auto migrate over legacy table: %v", err)
	}

	// 新模型可正常写入(关键新列均为 NOT NULL)。
	row := OperationLog{
		UserID: 1, Username: "admin", Action: "user.delete", Resource: "user",
		ResourceID: "1", Description: "删除用户 张三", Status: "success", CreatedAt: time.Now(),
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("insert business log after rebuild: %v", err)
	}
	var count int64
	if err := db.Model(&OperationLog{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("legacy rows should be gone, got %d", count)
	}

	// 已是新结构时重复 AutoMigrate 应保持幂等。
	if err := AutoMigrate(ctx, db); err != nil {
		t.Fatalf("second auto migrate: %v", err)
	}
}
