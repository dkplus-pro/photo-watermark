// Package uid 标识生成工具:随机 uuid(v4 简化实现,无外部依赖)。
// 原 storage.NewUUID 下沉至此(F2),uploads 会话标识与 storage 对象命名共用单一实现。
package uid

import (
	"crypto/rand"
	"fmt"
)

// NewUUID 生成随机 uuid(v4 简化实现,无外部依赖)。
func NewUUID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", buf[0:4], buf[4:6], buf[6:8], buf[8:10], buf[10:16]), nil
}
