// Package repo 内配置组相关查询与写入。
package repo

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func ListConfigsByGroup(ctx context.Context, db *gorm.DB, group string) ([]SysConfig, error) {
	var configs []SysConfig
	if err := db.WithContext(ctx).Where("`group` = ?", group).
		Order("key ASC").Find(&configs).Error; err != nil {
		return nil, fmt.Errorf("list configs by group: %w", err)
	}
	return configs, nil
}

// ReplaceConfigs 整组覆盖配置:删除该组不再存在的 key,其余 upsert。

func ReplaceConfigs(ctx context.Context, db *gorm.DB, group string, items []SysConfig, updatedBy int64) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		keepKeys := make([]string, 0, len(items))
		for _, item := range items {
			keepKeys = append(keepKeys, item.Key)
			cfg := SysConfig{Group: group, Key: item.Key, Value: item.Value, Remark: item.Remark, UpdatedBy: updatedBy}
			if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{
				{Name: "group"}, {Name: "key"},
			}, DoUpdates: clause.AssignmentColumns([]string{"value", "remark", "updated_by", "updated_at"})}).
					Create(&cfg).Error; err != nil {
				return fmt.Errorf("upsert config %s: %w", item.Key, err)
			}
		}
		delQuery := tx.Where("`group` = ?", group)
		if len(keepKeys) > 0 {
			delQuery = delQuery.Where("key NOT IN ?", keepKeys)
		}
		if err := delQuery.Delete(&SysConfig{}).Error; err != nil {
			return fmt.Errorf("delete removed configs: %w", err)
		}
		return nil
	})
}

// GetConfigValue 读单个配置值(种子与业务消费用)。

func GetConfigValue(ctx context.Context, db *gorm.DB, group, key string) (string, error) {
	var cfg SysConfig
	err := db.WithContext(ctx).Where("`group` = ? AND `key` = ?", group, key).First(&cfg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get config %s.%s: %w", group, key, err)
	}
	return cfg.Value, nil
}

// ===== 字典 =====

// ListDicts 字典全量列表,keyword 模糊匹配 code/name。
