// Package repo 负责数据库连接与建表,屏蔽具体存储驱动,供 service 层调用。
package repo

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

// DatabaseConfig repo 自有连接配置,与 config 包解耦(依赖矩阵:repo 零 internal 依赖)。
type DatabaseConfig struct {
	Driver string // sqlite / mysql
	DSN    string
}

// Open 按配置建立 GORM 连接。dev 用纯 Go 的 SQLite 驱动(免 cgo),生产切 MySQL。
func Open(cfg DatabaseConfig) (*gorm.DB, error) {
	switch cfg.Driver {
	case "sqlite":
		// SQLite 文件所在目录不存在时先创建,保证 data/cms.db 默认路径可用。
		if dir := filepath.Dir(cfg.DSN); dir != "." && dir != "" {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("create sqlite data dir: %w", err)
			}
		}
		return gorm.Open(sqlite.Open(cfg.DSN), &gorm.Config{})
	case "mysql":
		return gorm.Open(mysql.Open(cfg.DSN), &gorm.Config{})
	default:
		return nil, fmt.Errorf("unsupported database driver %q", cfg.Driver)
	}
}
