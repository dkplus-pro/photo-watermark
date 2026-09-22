// bootstrap 启动期装配逻辑:权限注册表同步与对账(幂等);main.go 只做流程编排。
package main

import (
	"context"
	"fmt"
	"log/slog"

	"gorm.io/gorm"

	"github.com/cms-template/server/internal/httpapi"
	"github.com/cms-template/server/internal/repo"
)

// bootstrapPermissions 把路由权限注册表同步进 permissions 表并做对账清理:
// 1) UpsertApiPermissions:注册表中的 API 权限点(含挂载菜单)幂等写入;
// 2) PrunePermissions:注册表移除的接口/模块,其权限点与授予记录一并删除(自愈)。
func bootstrapPermissions(ctx context.Context, db *gorm.DB, logger *slog.Logger) error {
	apiSeeds := make([]repo.ApiPermissionSeed, 0, len(httpapi.RoutePermissions))
	keepAPICodes := make([]string, 0, len(httpapi.RoutePermissions))
	keepMenuCodes := make([]string, 0)
	seen := make(map[string]bool)
	for _, rp := range httpapi.RoutePermissions {
		apiSeeds = append(apiSeeds, repo.ApiPermissionSeed{
			Code:           rp.Code,
			Name:           rp.Name,
			ParentMenuCode: rp.Menu,
			ParentMenuName: rp.MenuName,
		})
		keepAPICodes = append(keepAPICodes, rp.Code)
		if !seen[rp.Menu] {
			seen[rp.Menu] = true
			keepMenuCodes = append(keepMenuCodes, rp.Menu)
		}
	}
	if err := repo.UpsertApiPermissions(ctx, db, apiSeeds); err != nil {
		logger.Error("upsert api permissions", "error", err)
		return fmt.Errorf("upsert api permissions: %w", err)
	}
	if err := repo.PrunePermissions(ctx, db, keepAPICodes, keepMenuCodes); err != nil {
		logger.Error("prune permissions", "error", err)
		return fmt.Errorf("prune permissions: %w", err)
	}
	return nil
}
