// Package service 承载业务规则:系统配置组(见 docs/mvp-plan.md 阶段 4 修订)。
package service

import (
	"context"

	"errors"

	"gorm.io/gorm"

	"github.com/cms-template/server/internal/oplog"
	"github.com/cms-template/server/internal/repo"
	"github.com/cms-template/server/internal/types"
)

// 配置模块业务错误。
var ErrInvalidConfigGroup = errors.New("invalid config group")

// ConfigService 系统配置业务。
type ConfigService struct {
	db *gorm.DB
}

// NewConfigService 装配 ConfigService。

func NewConfigService(db *gorm.DB) *ConfigService {
	return &ConfigService{db: db}
}

// ConfigGroups 合法配置组;新增配置组时在此登记。
// 存储配置属运维项,已迁环境变量(.env.local,见 docs/mvp-plan.md 阶段 6),不再是配置组。

var ConfigGroups = []string{"system"}

// ValidConfigGroup 校验配置组合法性。

func ValidConfigGroup(group string) bool {
	for _, g := range ConfigGroups {
		if g == group {
			return true
		}
	}
	return false
}

// Get 读取配置组。

func (s *ConfigService) Get(ctx context.Context, group string) ([]types.ConfigItem, error) {
	if !ValidConfigGroup(group) {
		return nil, ErrInvalidConfigGroup
	}
	configs, err := repo.ListConfigsByGroup(ctx, s.db, group)
	if err != nil {
		return nil, err
	}
	items := make([]types.ConfigItem, 0, len(configs))
	for _, cfg := range configs {
		items = append(items, types.ConfigItem{Key: cfg.Key, Value: cfg.Value, Remark: cfg.Remark})
	}
	return items, nil
}

// Replace 整组更新配置(记业务日志)。

func (s *ConfigService) Replace(ctx context.Context, group string, items []types.ConfigItem, operatorID int64) error {
	if !ValidConfigGroup(group) {
		return ErrInvalidConfigGroup
	}
	configs := make([]repo.SysConfig, 0, len(items))
	for _, item := range items {
		configs = append(configs, repo.SysConfig{Key: item.Key, Value: item.Value, Remark: item.Remark})
	}
	if err := repo.ReplaceConfigs(ctx, s.db, group, configs, operatorID); err != nil {
		return err
	}
	oplog.Success(ctx, s.db, oplog.Entry{
		Action:      "config.update",
		Resource:    "config",
		ResourceID:  group,
		Description: "更新配置组 " + group,
	}, "")
	return nil
}

// DictService 字典管理业务。
