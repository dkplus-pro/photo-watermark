package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Local 本地目录存储;目录来自 STORAGE_BASE_PATH(默认 data/files)。
type Local struct {
	basePath string
}

// NewLocal 构造本地存储并确保目录存在。
func NewLocal(basePath string) (*Local, error) {
	if err := os.MkdirAll(basePath, 0o755); err != nil {
		return nil, fmt.Errorf("create storage dir: %w", err)
	}
	return &Local{basePath: basePath}, nil
}

// Save 写入文件。
func (l *Local) Save(_ context.Context, r io.Reader, ext string) (string, int64, error) {
	name, err := newName(ext)
	if err != nil {
		return "", 0, err
	}
	path := filepath.Join(l.basePath, name)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return "", 0, fmt.Errorf("create storage file: %w", err)
	}
	defer file.Close()

	size, err := io.Copy(file, r)
	if err != nil {
		_ = os.Remove(path) // 写一半失败不留半截文件
		return "", 0, fmt.Errorf("write storage file: %w", err)
	}
	return name, size, nil
}

// Open 打开文件;返回的 *os.File 同时是 io.ReadSeeker,内容端点据此保留 Range 播放。
func (l *Local) Open(_ context.Context, name string) (io.ReadCloser, error) {
	if !safeName.MatchString(name) {
		return nil, ErrInvalidName
	}
	file, err := os.Open(filepath.Join(l.basePath, name))
	if os.IsNotExist(err) {
		return nil, fmt.Errorf("%w: %s", os.ErrNotExist, name)
	}
	return file, err
}

// URL 本地存储没有外网地址,内容一律走 /files/{id}/content 端点。
func (l *Local) URL(string) string { return "" }

// Driver 驱动名。
func (l *Local) Driver() string { return "local" }

// Delete 删除文件;不存在视为成功。
func (l *Local) Delete(_ context.Context, name string) error {
	if !safeName.MatchString(name) {
		return ErrInvalidName
	}
	if err := os.Remove(filepath.Join(l.basePath, name)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete storage file: %w", err)
	}
	return nil
}
