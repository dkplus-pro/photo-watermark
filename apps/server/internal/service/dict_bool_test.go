package service

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/cms-template/server/internal/repo"
	"github.com/cms-template/server/internal/types"
)

// 回归:GORM 对带 default:true 的 bool 字段在 Create 时跳过零值,导致 status=false 被
// 数据库默认值覆盖为 true(曾导致"下线字典项"失效);模型已去掉 default 标签,GORM 总显式写入。
func TestDictEntryStatusPreservedFalse(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.AutoMigrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	svc := NewDictService(db)

	dict, err := svc.Create(ctx, "t", "T", "", true)
	if err != nil {
		t.Fatal(err)
	}
	entries := []types.DictEntry{
		{Label: "坏", Value: "0", Status: false},
		{Label: "好", Value: "1", Status: true},
	}
	if err := svc.ReplaceEntries(ctx, dict.ID, entries); err != nil {
		t.Fatal(err)
	}
	loaded, err := svc.ListEntries(ctx, "t")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range loaded {
		t.Logf("label=%s status=%v", e.Label, e.Status)
		if e.Label == "坏" && e.Status {
			t.Fatal("坏 should be disabled")
		}
	}
}
