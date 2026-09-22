package httpapi

import (
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// DailyFileWriter 按天滚动的日志文件写入器:写入 dir/prefix-YYYY-MM-DD.log,
// 跨天自动切换文件;每次切换时清理超过保留天数的旧文件(见 docs/database.md 访问日志节)。
type DailyFileWriter struct {
	dir        string
	prefix     string
	retainDays int

	mu      sync.Mutex
	day     string
	current *os.File
}

// NewDailyFileWriter 创建写入器并确保目录存在。
func NewDailyFileWriter(dir, prefix string, retainDays int) (*DailyFileWriter, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, errors.Join(err, os.ErrNotExist)
	}
	if retainDays <= 0 {
		retainDays = 7
	}
	return &DailyFileWriter{dir: dir, prefix: prefix, retainDays: retainDays}, nil
}

// Write 实现 io.Writer:按天切文件。
func (w *DailyFileWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	today := time.Now().Format("2006-01-02")
	if w.current == nil || w.day != today {
		if w.current != nil {
			_ = w.current.Close()
		}
		file, err := os.OpenFile(filepath.Join(w.dir, w.prefix+"-"+today+".log"),
			os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return 0, err
		}
		w.current = file
		w.day = today
		w.cleanupLocked()
	}
	return w.current.Write(p)
}

// Close 关闭当前文件。
func (w *DailyFileWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.current != nil {
		return w.current.Close()
	}
	return nil
}

// cleanupLocked 删除超过保留天数的旧日志文件;失败只忽略单个文件。
func (w *DailyFileWriter) cleanupLocked() {
	cutoff := time.Now().AddDate(0, 0, -w.retainDays)
	entries, err := os.ReadDir(w.dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || len(name) < len(w.prefix)+12 {
			continue
		}
		dayPart := name[len(w.prefix)+1 : len(w.prefix)+11]
		day, err := time.Parse("2006-01-02", dayPart)
		if err != nil || !day.Before(cutoff) {
			continue
		}
		_ = os.Remove(filepath.Join(w.dir, name))
	}
}

// NewAccessLogger 创建访问日志 logger:stdout + 按天滚动文件双写(开发排查看文件,见 docs/database.md)。
func NewAccessLogger(dir, prefix string, retainDays int) (*slog.Logger, func(), error) {
	writer, err := NewDailyFileWriter(dir, prefix, retainDays)
	if err != nil {
		return nil, nil, err
	}
	logger := slog.New(slog.NewTextHandler(io.MultiWriter(os.Stdout, writer), nil))
	return logger, func() { _ = writer.Close() }, nil
}
