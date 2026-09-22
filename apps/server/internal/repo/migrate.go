package repo

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// autoMigrateModels 全部业务模型,启动时幂等建表;新增模型在此追加(见 docs/database.md)。
var autoMigrateModels = []any{
	&User{},
	&Role{},
	&UserRole{},
	&Permission{},
	&RolePermission{},
	&OperationLog{},
	&SysConfig{},
	&Dict{},
	&DictEntry{},
	&File{},
	&MediaAsset{},
	&MediaGroup{},
}

// AutoMigrate 按声明顺序幂等建表。
func AutoMigrate(ctx context.Context, db *gorm.DB) error {
	if err := dropLegacyOperationLogs(ctx, db); err != nil {
		return err
	}
	for _, model := range autoMigrateModels {
		if err := db.AutoMigrate(model); err != nil {
			return fmt.Errorf("auto migrate %T: %w", model, err)
		}
	}
	return nil
}

// dropLegacyOperationLogs 重建阶段 4 修订前的旧 operation_logs 表。
// 旧表存的是 HTTP 访问日志字段(method/path/status_code/latency_ms),与业务日志模型
// 不兼容(新列均为 NOT NULL,SQLite 不允许无默认值加列),且旧数据已无保留价值——
// 该类日志现走文件(见 docs/database.md 访问日志节),故检测到旧结构直接删表重建。
func dropLegacyOperationLogs(ctx context.Context, db *gorm.DB) error {
	// 方言守卫:pragma_table_info 是 SQLite 专有 SQL,旧表结构只存在于早期 SQLite dev
	// 部署;MySQL 环境从未创建过该结构,直接跳过,避免切 MySQL 后启动报错(F8)。
	if db.Dialector.Name() != "sqlite" {
		return nil
	}
	var legacyColumns int64
	err := db.WithContext(ctx).Raw(
		"SELECT COUNT(*) FROM pragma_table_info('operation_logs') WHERE name IN ('method','status_code','latency_ms')",
	).Scan(&legacyColumns).Error
	if err != nil {
		return fmt.Errorf("inspect legacy operation_logs: %w", err)
	}
	if legacyColumns == 0 {
		return nil
	}
	if err := db.WithContext(ctx).Migrator().DropTable("operation_logs"); err != nil {
		return fmt.Errorf("drop legacy operation_logs: %w", err)
	}
	return nil
}
