// Package oplog 业务操作日志:由 service 层在增删改与登录处显式埋点(查询不记),
// 记录"谁在什么时间对什么对象做了什么、结果如何",给运营查看(见 docs/mvp-plan.md 阶段 4 修订)。
package oplog

import (
	"context"
	"log/slog"

	"gorm.io/gorm"

	"github.com/cms-template/server/internal/repo"
	"github.com/cms-template/server/internal/reqctx"
)

// 业务动作状态。
const (
	StatusSuccess = "success"
	StatusFailed  = "failed"
)

// Entry 埋点载荷;操作人与 IP 从请求上下文取,调用方只填业务语义字段。
type Entry struct {
	Action      string // 资源.动作,如 user.delete
	Resource    string // 资源类型,如 user / role / config
	ResourceID  string // 资源标识,统一字符串
	Description string // 人话描述,如"删除用户 张三(zhangsan)"
	Status      string // success / failed
}

// Record 落一条业务操作日志;context 中无登录信息时(如登录失败)username 取 entry 回退值。
// 记录失败只打错误日志,不影响业务结果。
func Record(ctx context.Context, db *gorm.DB, entry Entry, usernameFallback string) {
	if entry.Status == "" {
		entry.Status = StatusSuccess
	}

	userID := int64(0)
	username := usernameFallback
	if identity, ok := reqctx.IdentityFrom(ctx); ok {
		userID = identity.UserID
		username = identity.Username
	}

	err := repo.CreateOperationLog(ctx, db, repo.OperationLog{
		UserID:      userID,
		Username:    username,
		Action:      entry.Action,
		Resource:    entry.Resource,
		ResourceID:  entry.ResourceID,
		Description: entry.Description,
		Status:      entry.Status,
		IP:          reqctx.ClientIPFrom(ctx),
	})
	if err != nil {
		slog.Error("record operation log", "action", entry.Action, "error", err)
	}
}

// Success 便捷封装:记录成功动作。
func Success(ctx context.Context, db *gorm.DB, entry Entry, usernameFallback string) {
	entry.Status = StatusSuccess
	Record(ctx, db, entry, usernameFallback)
}

// Failed 便捷封装:记录失败动作。
func Failed(ctx context.Context, db *gorm.DB, entry Entry, usernameFallback string) {
	entry.Status = StatusFailed
	Record(ctx, db, entry, usernameFallback)
}
