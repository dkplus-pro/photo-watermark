// Package h5 实现 openapi/h5/ 生成的活动 H5 ServerInterface。
// 占坑期匿名公开、只读,不注入任何 service;C 端用户认证落地时在 main.go 装配处插入 JWTAuth 预留槽位。
package h5

import (
	"log/slog"

	h5gen "github.com/cms-template/server/gen/h5"
)

// H5Handler 活动 H5(h5)接口装配。
type H5Handler struct {
	logger *slog.Logger
}

// New 构造 H5Handler。
func New(logger *slog.Logger) *H5Handler {
	return &H5Handler{logger: logger}
}

// ensureH5Gen 编译期校验:H5Handler 实现生成物的 ServerInterface。
var _ h5gen.ServerInterface = (*H5Handler)(nil)
