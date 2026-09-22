// Package storage 文件存储抽象:底层 files 表的上游,屏蔽本地目录与各厂商对象存储的差异。
// 一个厂商一个实现文件(local.go / cos.go),新增厂商见 docs/mvp-plan.md 阶段 6。
package storage

import (
	"context"
	"errors"
	"io"
	"regexp"

	"github.com/cms-template/server/internal/uid"
)

// ErrInvalidName 存储名非法(防目录穿越)。
var ErrInvalidName = errors.New("invalid storage name")

var safeName = regexp.MustCompile(`^[a-f0-9-]{36}(\.[a-z0-9]{1,8})?$`)

// Storage 文件存储接口,业务层(media 等)只面向它编程,不感知厂商。
type Storage interface {
	// Save 写入文件内容,返回生成的对象 key(可选厂商前缀 + uuid + 扩展名)与字节数。
	Save(ctx context.Context, r io.Reader, ext string) (key string, size int64, err error)
	// Open 顺序读对象内容(信息提取、本地内容端点用);本地实现返回 *os.File。
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	// URL 返回外网可访问地址(CDN 直链);本地存储返回 ""。
	URL(key string) string
	// Driver 返回驱动名(local / cos ...),写入 files.storage。
	Driver() string
	// Delete 删除对象;对象不存在视为已删除(幂等)。
	Delete(ctx context.Context, key string) error
}

// newName 生成裸存储名(uuid + 扩展名),各厂商自行决定是否再加前缀。
func newName(ext string) (string, error) {
	id, err := uid.NewUUID()
	if err != nil {
		return "", err
	}
	name := id
	if ext != "" {
		name += "." + ext
	}
	if !safeName.MatchString(name) {
		return "", ErrInvalidName
	}
	return name, nil
}
