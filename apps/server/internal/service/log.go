// Package service 承载业务规则:操作日志查询(只读)。
package service

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/cms-template/server/internal/repo"
	"github.com/cms-template/server/internal/types"
)

// LogService 操作日志查询(只读)。

type LogService struct {
	db *gorm.DB
}

// NewLogService 装配 LogService。

func NewLogService(db *gorm.DB) *LogService {
	return &LogService{db: db}
}

// List 业务操作日志分页(查询操作本身不记日志)。

func (s *LogService) List(
	ctx context.Context,
	page, pageSize int,
	username, resource, action string,
	status *string,
	startTime, endTime *time.Time,
) ([]types.OperationLogItem, int64, error) {
	logs, total, err := repo.ListOperationLogs(ctx, s.db, page, pageSize, username, resource, action, status, startTime, endTime)
	if err != nil {
		return nil, 0, err
	}

	items := make([]types.OperationLogItem, 0, len(logs))
	for _, log := range logs {
		items = append(items, types.OperationLogItem{
			ID: log.ID, UserID: log.UserID, Username: log.Username,
			Action: log.Action, Resource: log.Resource, ResourceID: log.ResourceID,
			Description: log.Description, Status: log.Status,
			IP: log.IP, CreatedAt: log.CreatedAt,
		})
	}
	return items, total, nil
}

// ConfigService 系统配置业务。
