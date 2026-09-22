package repo

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// OperationLog 业务操作日志,只增不改(方案见 docs/database.md 与 docs/mvp-plan.md 阶段 4 修订)。
// 记录"谁在什么时间对什么对象做了什么、结果如何";由 service 层显式埋点,查询不记。
type OperationLog struct {
	ID          int64     `gorm:"primaryKey;autoIncrement"`
	UserID      int64     `gorm:"not null;default:0;index:idx_oplog_user_time,priority:1"`
	Username    string    `gorm:"size:64"`
	Action      string    `gorm:"size:64;not null"`
	Resource    string    `gorm:"size:64;not null;index:idx_oplog_resource,priority:1"`
	ResourceID  string    `gorm:"size:64;index:idx_oplog_resource,priority:2"`
	Description string    `gorm:"size:255;not null"`
	Status      string    `gorm:"size:16;not null"`
	IP          string    `gorm:"size:45"`
	CreatedAt   time.Time `gorm:"not null;index;index:idx_oplog_user_time,priority:2"`
}

func (OperationLog) TableName() string { return "operation_logs" }

// CreateOperationLog 写一条业务操作日志;只增不改。
func CreateOperationLog(ctx context.Context, db *gorm.DB, log OperationLog) error {
	if err := db.WithContext(ctx).Create(&log).Error; err != nil {
		return fmt.Errorf("create operation log: %w", err)
	}
	return nil
}

func ListOperationLogs(
	ctx context.Context,
	db *gorm.DB,
	page, pageSize int,
	username, resource, action string,
	status *string,
	startTime, endTime *time.Time,
) ([]OperationLog, int64, error) {
	query := db.WithContext(ctx).Model(&OperationLog{})
	if username != "" {
		query = query.Where("username LIKE ?", "%"+username+"%")
	}
	if resource != "" {
		query = query.Where("resource = ?", resource)
	}
	if action != "" {
		query = query.Where("action = ?", action)
	}
	if status != nil {
		query = query.Where("status = ?", *status)
	}
	if startTime != nil {
		query = query.Where("created_at >= ?", *startTime)
	}
	if endTime != nil {
		query = query.Where("created_at < ?", endTime.Add(time.Millisecond))
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count operation logs: %w", err)
	}

	var logs []OperationLog
	if err := query.Order("id DESC").
		Limit(pageSize).Offset((page - 1) * pageSize).
		Find(&logs).Error; err != nil {
		return nil, 0, fmt.Errorf("list operation logs: %w", err)
	}
	return logs, total, nil
}

// ===== 系统配置 =====

// ListConfigsByGroup 配置组键值列表(按 key 排序)。
