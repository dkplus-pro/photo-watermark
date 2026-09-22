package media

import (
	"context"
	"errors"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/cms-template/server/internal/oplog"
	"github.com/cms-template/server/internal/repo"
)

// newGroupService 内存 SQLite + AutoMigrate(含 media_groups 与 media_assets.group_id)。
// 分组路径不触介质,storage 置 nil;媒体记录直接经 repo 造数,覆盖业务与日志逻辑。
func newGroupService(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := repo.AutoMigrate(context.Background(), db); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	return NewService(db, nil)
}

// seedAsset 直接落一条媒体记录(绕过上传管线;底层 files 记录一并落,详情富化需要)。
func seedAsset(t *testing.T, s *Service, kind, title string, groupID int64) repo.MediaAsset {
	t.Helper()
	file := repo.File{OrigName: title, Name: title + "-obj", Path: title + "-obj", Size: 1}
	if err := repo.CreateFile(context.Background(), s.db, &file); err != nil {
		t.Fatalf("seed file: %v", err)
	}
	asset := repo.MediaAsset{Kind: kind, FileID: file.ID, Title: title, GroupID: groupID}
	if err := repo.CreateMediaAsset(context.Background(), s.db, &asset); err != nil {
		t.Fatalf("seed asset: %v", err)
	}
	return asset
}

func countLogs(t *testing.T, s *Service, action, status string) int64 {
	t.Helper()
	var count int64
	if err := s.db.Model(&repo.OperationLog{}).Where("action = ? AND status = ?", action, status).Count(&count).Error; err != nil {
		t.Fatalf("count logs: %v", err)
	}
	return count
}

func TestGroupCRUD(t *testing.T) {
	s := newGroupService(t)
	ctx := context.Background()

	// 建组 + 计数为 0
	group, err := s.CreateGroup(ctx, KindImage, " 轮播图 ")
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	if group.Name != "轮播图" {
		t.Fatalf("expected trimmed name, got %q", group.Name)
	}

	// 同类型重名 409;异类型同名允许
	if _, err := s.CreateGroup(ctx, KindImage, "轮播图"); !errors.Is(err, ErrGroupNameExists) {
		t.Fatalf("expected ErrGroupNameExists, got %v", err)
	}
	if countLogs(t, s, "mediaGroup.create", oplog.StatusFailed) != 1 {
		t.Fatalf("expected 1 failed log for duplicate create, got %d", countLogs(t, s, "mediaGroup.create", oplog.StatusFailed))
	}
	if _, err := s.CreateGroup(ctx, KindVideo, "轮播图"); err != nil {
		t.Fatalf("same name in other kind should pass: %v", err)
	}
	if countLogs(t, s, "mediaGroup.create", oplog.StatusSuccess) != 2 {
		t.Fatalf("expected 2 success logs for create, got %d", countLogs(t, s, "mediaGroup.create", oplog.StatusSuccess))
	}

	// 非法类型 / 非法名称
	if _, err := s.CreateGroup(ctx, KindAudio, "音频组"); !errors.Is(err, ErrInvalidType) {
		t.Fatalf("expected ErrInvalidType, got %v", err)
	}
	if _, err := s.CreateGroup(ctx, KindImage, ""); !errors.Is(err, ErrInvalidGroupName) {
		t.Fatalf("expected ErrInvalidGroupName, got %v", err)
	}

	// 组内计数
	seedAsset(t, s, KindImage, "a.png", group.ID)
	seedAsset(t, s, KindImage, "b.png", group.ID)
	groups, err := s.ListGroups(ctx, KindImage)
	if err != nil {
		t.Fatalf("list groups: %v", err)
	}
	if len(groups) != 1 || groups[0].MediaCount != 2 {
		t.Fatalf("unexpected groups: %+v", groups)
	}

	// 重命名成功(含同名同组自身放行)
	renamed, err := s.RenameGroup(ctx, group.ID, "轮播图")
	if err != nil {
		t.Fatalf("rename to same name should pass: %v", err)
	}
	if _, err := s.RenameGroup(ctx, group.ID, "头图"); err != nil {
		t.Fatalf("rename group: %v", err)
	}
	if renamed.Name == "头图" {
		t.Fatal("rename should return updated group")
	}
	videoGroup, err := s.CreateGroup(ctx, KindVideo, "宣传片")
	if err != nil {
		t.Fatalf("create video group: %v", err)
	}
	// 跨类型同名不冲突,但同类型内冲突 409
	if _, err := s.CreateGroup(ctx, KindVideo, "头图"); err != nil {
		t.Fatalf("video group named 头图 should pass: %v", err)
	}
	if _, err := s.RenameGroup(ctx, videoGroup.ID, "头图"); err == nil {
		t.Fatal("video rename to 头图 should conflict (video has 头图 now)")
	} else if !errors.Is(err, ErrGroupNameExists) {
		t.Fatalf("expected ErrGroupNameExists, got %v", err)
	}
	if countLogs(t, s, "mediaGroup.update", oplog.StatusSuccess) != 2 {
		t.Fatalf("expected 2 update logs, got %d", countLogs(t, s, "mediaGroup.update", oplog.StatusSuccess))
	}

	// 删组:资源移回未分组,资源本身不删
	if err := s.DeleteGroup(ctx, group.ID); err != nil {
		t.Fatalf("delete group: %v", err)
	}
	assets, total, err := s.List(ctx, KindImage, nil, 1, 20)
	if err != nil || total != 2 {
		t.Fatalf("assets should survive group delete: %d, %v", total, err)
	}
	for _, asset := range assets {
		if asset.GroupID != 0 || asset.GroupName != "" {
			t.Fatalf("asset should be ungrouped after delete: %+v", asset)
		}
	}
	if err := s.DeleteGroup(ctx, group.ID); !errors.Is(err, ErrMediaGroupNotFound) {
		t.Fatalf("expected ErrMediaGroupNotFound, got %v", err)
	}
	if countLogs(t, s, "mediaGroup.delete", oplog.StatusSuccess) != 1 {
		t.Fatalf("expected 1 delete log, got %d", countLogs(t, s, "mediaGroup.delete", oplog.StatusSuccess))
	}
}

func TestListAssetsByGroup(t *testing.T) {
	s := newGroupService(t)
	ctx := context.Background()

	imageGroup, err := s.CreateGroup(ctx, KindImage, "轮播图")
	if err != nil {
		t.Fatalf("create image group: %v", err)
	}
	videoGroup, err := s.CreateGroup(ctx, KindVideo, "宣传片")
	if err != nil {
		t.Fatalf("create video group: %v", err)
	}
	inGroup := seedAsset(t, s, KindImage, "a.png", imageGroup.ID)
	ungrouped := seedAsset(t, s, KindImage, "b.png", 0)
	seedAsset(t, s, KindVideo, "c.mp4", videoGroup.ID)

	// 不传 = 全部
	_, total, err := s.List(ctx, KindImage, nil, 1, 20)
	if err != nil || total != 2 {
		t.Fatalf("expected 2 images, got %d, %v", total, err)
	}
	// 0 = 未分组
	items, total, err := s.List(ctx, KindImage, int64Ptr(0), 1, 20)
	if err != nil || total != 1 {
		t.Fatalf("expected 1 ungrouped image, got %d, %v", total, err)
	}
	if items[0].ID != ungrouped.ID || items[0].GroupID != 0 || items[0].GroupName != "" {
		t.Fatalf("unexpected ungrouped item: %+v", items[0])
	}
	// 指定分组 = 组内资源,groupName 已富化
	items, total, err = s.List(ctx, KindImage, int64Ptr(imageGroup.ID), 1, 20)
	if err != nil || total != 1 {
		t.Fatalf("expected 1 grouped image, got %d, %v", total, err)
	}
	if items[0].ID != inGroup.ID || items[0].GroupName != "轮播图" {
		t.Fatalf("unexpected grouped item: %+v", items[0])
	}
	// 分组按 kind 隔离:图片组过滤视频列表为空
	_, total, err = s.List(ctx, KindVideo, int64Ptr(imageGroup.ID), 1, 20)
	if err != nil || total != 0 {
		t.Fatalf("expected 0 for image group on videos, got %d, %v", total, err)
	}
}

func TestMoveGroup(t *testing.T) {
	s := newGroupService(t)
	ctx := context.Background()

	imageGroup, err := s.CreateGroup(ctx, KindImage, "轮播图")
	if err != nil {
		t.Fatalf("create image group: %v", err)
	}
	videoGroup, err := s.CreateGroup(ctx, KindVideo, "宣传片")
	if err != nil {
		t.Fatalf("create video group: %v", err)
	}
	asset := seedAsset(t, s, KindImage, "a.png", 0)

	// 移入分组
	moved, err := s.MoveGroup(ctx, asset.ID, imageGroup.ID)
	if err != nil {
		t.Fatalf("move group: %v", err)
	}
	if moved.GroupID != imageGroup.ID || moved.GroupName != "轮播图" {
		t.Fatalf("unexpected moved asset: %+v", moved)
	}
	if countLogs(t, s, "media.moveGroup", oplog.StatusSuccess) != 1 {
		t.Fatalf("expected 1 move log, got %d", countLogs(t, s, "media.moveGroup", oplog.StatusSuccess))
	}

	// 移出分组(0)
	moved, err = s.MoveGroup(ctx, asset.ID, 0)
	if err != nil {
		t.Fatalf("move out group: %v", err)
	}
	if moved.GroupID != 0 || moved.GroupName != "" {
		t.Fatalf("expected ungrouped asset, got %+v", moved)
	}

	// 目标分组类型不匹配
	if _, err := s.MoveGroup(ctx, asset.ID, videoGroup.ID); !errors.Is(err, ErrInvalidGroup) {
		t.Fatalf("expected ErrInvalidGroup, got %v", err)
	}
	if countLogs(t, s, "media.moveGroup", oplog.StatusFailed) != 1 {
		t.Fatalf("expected 1 failed move log, got %d", countLogs(t, s, "media.moveGroup", oplog.StatusFailed))
	}
	// 目标分组不存在
	if _, err := s.MoveGroup(ctx, asset.ID, 9999); !errors.Is(err, ErrInvalidGroup) {
		t.Fatalf("expected ErrInvalidGroup for missing group, got %v", err)
	}
	// 资源不存在
	if _, err := s.MoveGroup(ctx, 8888, imageGroup.ID); !errors.Is(err, ErrMediaNotFound) {
		t.Fatalf("expected ErrMediaNotFound, got %v", err)
	}
}

func int64Ptr(v int64) *int64 { return &v }
