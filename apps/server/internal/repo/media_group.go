package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// ErrMediaGroupNotFound 媒体分组不存在。
var ErrMediaGroupNotFound = errors.New("media group not found")

// MediaGroup 媒体分组(图片/视频共用;同 kind 内 name 唯一,见 docs/admin-enhancement-plan.md 阶段 13)。
type MediaGroup struct {
	ID        int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Kind      string    `gorm:"size:16;not null;uniqueIndex:uk_media_group_kind_name" json:"kind"`
	Name      string    `gorm:"size:64;not null;uniqueIndex:uk_media_group_kind_name" json:"name"`
	CreatedAt time.Time `gorm:"not null" json:"createdAt"`
}

func (MediaGroup) TableName() string { return "media_groups" }

// MediaGroupWithCount 分组 + 组内资源计数(LEFT JOIN 统计)。
type MediaGroupWithCount struct {
	MediaGroup
	MediaCount int64 `json:"mediaCount"`
}

// CreateMediaGroup 新建媒体分组。
func CreateMediaGroup(ctx context.Context, db *gorm.DB, group *MediaGroup) error {
	if err := db.WithContext(ctx).Create(group).Error; err != nil {
		return fmt.Errorf("create media group: %w", err)
	}
	return nil
}

// GetMediaGroupByID 按主键查分组。
func GetMediaGroupByID(ctx context.Context, db *gorm.DB, id int64) (MediaGroup, error) {
	var group MediaGroup
	err := db.WithContext(ctx).First(&group, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return MediaGroup{}, ErrMediaGroupNotFound
	}
	if err != nil {
		return MediaGroup{}, fmt.Errorf("get media group by id: %w", err)
	}
	return group, nil
}

// GetMediaGroupByName 同类型内按名称查分组(重名冲突检测用)。
func GetMediaGroupByName(ctx context.Context, db *gorm.DB, kind, name string) (MediaGroup, error) {
	var group MediaGroup
	err := db.WithContext(ctx).Where("kind = ? AND name = ?", kind, name).First(&group).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return MediaGroup{}, ErrMediaGroupNotFound
	}
	if err != nil {
		return MediaGroup{}, fmt.Errorf("get media group by name: %w", err)
	}
	return group, nil
}

// ListMediaGroups 某类型的全部分组,LEFT JOIN media_assets 统计组内资源数。
func ListMediaGroups(ctx context.Context, db *gorm.DB, kind string) ([]MediaGroupWithCount, error) {
	var groups []MediaGroupWithCount
	err := db.WithContext(ctx).Model(&MediaGroup{}).
		Select("media_groups.*, COUNT(media_assets.id) AS media_count").
		Joins("LEFT JOIN media_assets ON media_assets.group_id = media_groups.id AND media_assets.kind = media_groups.kind").
		Where("media_groups.kind = ?", kind).
		Group("media_groups.id").
		Order("media_groups.id ASC").
		Scan(&groups).Error
	if err != nil {
		return nil, fmt.Errorf("list media groups: %w", err)
	}
	return groups, nil
}

// UpdateMediaGroup 更新分组(当前仅重命名)。
func UpdateMediaGroup(ctx context.Context, db *gorm.DB, group *MediaGroup) error {
	if err := db.WithContext(ctx).Save(group).Error; err != nil {
		return fmt.Errorf("update media group: %w", err)
	}
	return nil
}

// DeleteMediaGroup 删除分组,事务内将组内资源 group_id 置 0(移回未分组),不删资源。
func DeleteMediaGroup(ctx context.Context, db *gorm.DB, id int64) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&MediaAsset{}).Where("group_id = ?", id).Update("group_id", 0).Error; err != nil {
			return fmt.Errorf("detach group assets: %w", err)
		}
		if err := tx.Delete(&MediaGroup{}, id).Error; err != nil {
			return fmt.Errorf("delete media group: %w", err)
		}
		return nil
	})
}

// UpdateMediaAssetGroup 移动媒体资源到指定分组(groupID 0=未分组)。
func UpdateMediaAssetGroup(ctx context.Context, db *gorm.DB, assetID, groupID int64) error {
	if err := db.WithContext(ctx).Model(&MediaAsset{}).Where("id = ?", assetID).
		Update("group_id", groupID).Error; err != nil {
		return fmt.Errorf("update media asset group: %w", err)
	}
	return nil
}

// GetMediaGroupNames 批量取分组名(媒体列表富化 groupName 用)。
func GetMediaGroupNames(ctx context.Context, db *gorm.DB, kind string, ids []int64) (map[int64]string, error) {
	names := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return names, nil
	}
	var groups []MediaGroup
	if err := db.WithContext(ctx).Where("kind = ? AND id IN ?", kind, ids).Find(&groups).Error; err != nil {
		return nil, fmt.Errorf("get media group names: %w", err)
	}
	for _, group := range groups {
		names[group.ID] = group.Name
	}
	return names, nil
}
