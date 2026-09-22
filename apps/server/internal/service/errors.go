// 业务层 not-found 哨兵:repo 哨兵在本包出口处转译,handler 只判业务哨兵
// (转译边界见 apps/server/AGENTS.md §3,依赖矩阵禁止 handler import repo)。
package service

import (
	"errors"
)

// 领域 not-found 哨兵,与 repo 哨兵一一对应。
var (
	ErrUserNotFound      = errors.New("user not found")
	ErrRoleNotFound      = errors.New("role not found")
	ErrDictNotFound      = errors.New("dict not found")
	ErrDictEntryNotFound = errors.New("dict entry not found")
)

// translateRepoErr repo 哨兵 → 本包哨兵的单点转译;非目标错误原样透传(500 语义不变)。
func translateRepoErr(err, from, to error) error {
	if errors.Is(err, from) {
		return to
	}
	return err
}
