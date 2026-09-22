package service

import (
	"context"

	"gorm.io/gorm"

	"github.com/cms-template/server/internal/repo"
	"github.com/cms-template/server/internal/types"
)

// PermissionService 权限点业务。
type PermissionService struct {
	db *gorm.DB
}

// NewPermissionService 装配 PermissionService。
func NewPermissionService(db *gorm.DB) *PermissionService {
	return &PermissionService{db: db}
}

// Tree 全量权限点树:menu 节点为根(menu 权限点 parent_id=0),api 节点挂在其所属模块的 menu 点下。
func (s *PermissionService) Tree(ctx context.Context) ([]types.PermissionNode, error) {
	list, err := repo.ListPermissions(ctx, s.db)
	if err != nil {
		return nil, err
	}

	nodes := make(map[int64]*types.PermissionNode, len(list))
	for _, p := range list {
		nodes[p.ID] = &types.PermissionNode{
			ID: p.ID, Code: p.Code, Name: p.Name, Type: p.Type, ParentID: p.ParentID,
		}
	}

	var rootPtrs []*types.PermissionNode
	for _, p := range list {
		node := nodes[p.ID]
		if parent, ok := nodes[p.ParentID]; ok && p.ParentID != 0 {
			parent.Children = append(parent.Children, *node)
		} else {
			rootPtrs = append(rootPtrs, node)
		}
	}
	roots := make([]types.PermissionNode, 0, len(rootPtrs))
	for _, ptr := range rootPtrs {
		roots = append(roots, *ptr)
	}
	return roots, nil
}
