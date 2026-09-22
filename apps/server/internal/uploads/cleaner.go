package uploads

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// CleanupExpired 清理超过 SessionTTL 的未完成会话,返回删除的会话数。
// 以 meta.json 的 createdAt 为准;元数据损坏的会话同样视为过期删除。
// 单个会话删除失败不中断其余清理,由下一次定时再兜底。
func (s *Service) CleanupExpired() int {
	entries, err := os.ReadDir(s.baseDir)
	if err != nil {
		return 0 // 根目录不存在说明尚无会话
	}
	deadline := time.Now().Add(-SessionTTL)
	removed := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join(s.baseDir, entry.Name())
		created, err := sessionCreatedAt(dir)
		if err != nil || created.After(deadline) {
			continue // 元数据缺失可能是初始化进行中,留给下一轮
		}
		if err := os.RemoveAll(dir); err != nil {
			continue
		}
		removed++
	}
	return removed
}

// sessionCreatedAt 读取会话元数据中的创建时间。
func sessionCreatedAt(dir string) (time.Time, error) {
	data, err := os.ReadFile(filepath.Join(dir, metaFile))
	if err != nil {
		return time.Time{}, err
	}
	var m meta
	if err := json.Unmarshal(data, &m); err != nil {
		return time.Time{}, err
	}
	return m.CreatedAt, nil
}

// StartCleaner 启动会话清理器:启动时先清一轮,之后每小时定时清理;
// ctx 取消即退出。由 main 装配(goroutine 内部自旋,调用方无需再 go)。
func (s *Service) StartCleaner(ctx context.Context, logger *slog.Logger) {
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		clean := func() {
			if n := s.CleanupExpired(); n > 0 {
				logger.Info("clean expired upload sessions", "removed", n)
			}
		}
		clean()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				clean()
			}
		}
	}()
}
