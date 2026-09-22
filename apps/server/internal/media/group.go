// 分组业务:媒体资源分组(阶段 13,见 docs/admin-enhancement-plan.md)。
// 分组为图片/视频共用能力,按 kind 隔离;埋点 action 前缀 mediaGroup / media.moveGroup。
package media

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cms-template/server/internal/oplog"
	"github.com/cms-template/server/internal/repo"
)

// GroupNameMaxLen 分组名上限(与契约 maxLength 一致)。
const GroupNameMaxLen = 64

// Group 媒体分组出参(含组内资源计数)。
type Group struct {
	ID         int64
	Kind       string
	Name       string
	MediaCount int64
	CreatedAt  time.Time
}

// ListGroups 某类型的分组列表(含组内资源计数)。
func (s *Service) ListGroups(ctx context.Context, kind string) ([]Group, error) {
	if err := validateGroupKind(kind); err != nil {
		return nil, err
	}
	groups, err := repo.ListMediaGroups(ctx, s.db, kind)
	if err != nil {
		return nil, err
	}
	items := make([]Group, 0, len(groups))
	for _, group := range groups {
		items = append(items, Group{
			ID: group.ID, Kind: group.Kind, Name: group.Name,
			MediaCount: group.MediaCount, CreatedAt: group.CreatedAt,
		})
	}
	return items, nil
}

// CreateGroup 新建分组(同类型内名称唯一,记业务日志,失败也记)。
func (s *Service) CreateGroup(ctx context.Context, kind, name string) (Group, error) {
	if err := validateGroupKind(kind); err != nil {
		return Group{}, err
	}
	name = strings.TrimSpace(name)
	if err := validateGroupName(name); err != nil {
		return Group{}, err
	}
	if _, err := repo.GetMediaGroupByName(ctx, s.db, kind, name); err == nil {
		s.logGroupFailed(ctx, "mediaGroup.create", "",
			"创建"+kindLabel(kind)+"分组 "+name+"(名称已存在)")
		return Group{}, ErrGroupNameExists
	} else if !errors.Is(err, repo.ErrMediaGroupNotFound) {
		return Group{}, err
	}
	group := repo.MediaGroup{Kind: kind, Name: name}
	if err := repo.CreateMediaGroup(ctx, s.db, &group); err != nil {
		return Group{}, err
	}
	oplog.Success(ctx, s.db, oplog.Entry{
		Action: "mediaGroup.create", Resource: "media_group", ResourceID: fmt.Sprint(group.ID),
		Description: "创建" + kindLabel(kind) + "分组 " + name,
	}, "")
	return Group{ID: group.ID, Kind: group.Kind, Name: group.Name, CreatedAt: group.CreatedAt}, nil
}

// RenameGroup 重命名分组(同类型内名称唯一,记业务日志,失败也记)。
func (s *Service) RenameGroup(ctx context.Context, id int64, name string) (Group, error) {
	name = strings.TrimSpace(name)
	if err := validateGroupName(name); err != nil {
		return Group{}, err
	}
	group, err := repo.GetMediaGroupByID(ctx, s.db, id)
	if err != nil {
		if errors.Is(err, repo.ErrMediaGroupNotFound) {
			s.logGroupFailed(ctx, "mediaGroup.update", fmt.Sprint(id), "重命名分组失败:分组不存在")
		}
		return Group{}, translateMediaErr(err)
	}
	if conflict, err := repo.GetMediaGroupByName(ctx, s.db, group.Kind, name); err == nil && conflict.ID != id {
		s.logGroupFailed(ctx, "mediaGroup.update", fmt.Sprint(id),
			"重命名"+kindLabel(group.Kind)+"分组 "+group.Name+" 为 "+name+"(名称已存在)")
		return Group{}, ErrGroupNameExists
	} else if err != nil && !errors.Is(err, repo.ErrMediaGroupNotFound) {
		return Group{}, err
	}
	oldName := group.Name
	group.Name = name
	if err := repo.UpdateMediaGroup(ctx, s.db, &group); err != nil {
		return Group{}, err
	}
	oplog.Success(ctx, s.db, oplog.Entry{
		Action: "mediaGroup.update", Resource: "media_group", ResourceID: fmt.Sprint(id),
		Description: "重命名" + kindLabel(group.Kind) + "分组 " + oldName + " 为 " + name,
	}, "")
	return Group{ID: group.ID, Kind: group.Kind, Name: group.Name, CreatedAt: group.CreatedAt}, nil
}

// DeleteGroup 删除分组:事务内将组内资源移回未分组,不删资源(记业务日志,失败也记)。
func (s *Service) DeleteGroup(ctx context.Context, id int64) error {
	group, err := repo.GetMediaGroupByID(ctx, s.db, id)
	if err != nil {
		if errors.Is(err, repo.ErrMediaGroupNotFound) {
			s.logGroupFailed(ctx, "mediaGroup.delete", fmt.Sprint(id), "删除分组失败:分组不存在")
		}
		return translateMediaErr(err)
	}
	if err := repo.DeleteMediaGroup(ctx, s.db, id); err != nil {
		return err
	}
	oplog.Success(ctx, s.db, oplog.Entry{
		Action: "mediaGroup.delete", Resource: "media_group", ResourceID: fmt.Sprint(id),
		Description: "删除" + kindLabel(group.Kind) + "分组 " + group.Name,
	}, "")
	return nil
}

// MoveGroup 移动媒体资源到指定分组(groupID 0=移出分组,记业务日志,失败也记)。
func (s *Service) MoveGroup(ctx context.Context, id, groupID int64) (Asset, error) {
	asset, err := repo.GetMediaAssetByID(ctx, s.db, id)
	if err != nil {
		return Asset{}, translateMediaErr(err)
	}
	if err := s.validateGroupOfKind(ctx, asset.Kind, groupID); err != nil {
		s.logGroupFailed(ctx, "media.moveGroup", fmt.Sprint(id),
			"移动"+kindLabel(asset.Kind)+" "+asset.Title+"失败:目标分组无效")
		return Asset{}, err
	}
	if err := repo.UpdateMediaAssetGroup(ctx, s.db, id, groupID); err != nil {
		return Asset{}, err
	}
	description := "移动" + kindLabel(asset.Kind) + " " + asset.Title + " 到未分组"
	if groupID > 0 {
		description = "移动" + kindLabel(asset.Kind) + " " + asset.Title + " 到分组 " + s.groupNameOf(ctx, groupID)
	}
	oplog.Success(ctx, s.db, oplog.Entry{
		Action: "media.moveGroup", Resource: asset.Kind, ResourceID: fmt.Sprint(id),
		Description: description,
	}, "")
	return s.Get(ctx, id)
}

// ValidateGroup 校验分组存在且类型匹配(0=未分组放行);分片上传初始化时提前校验,
// complete 走 Upload 管线时仍会复检,以此兜底中途变更。
func (s *Service) ValidateGroup(ctx context.Context, kind string, groupID int64) error {
	return s.validateGroupOfKind(ctx, kind, groupID)
}

// validateGroupOfKind 校验目标分组存在且与媒体类型匹配(0=未分组,放行)。
func (s *Service) validateGroupOfKind(ctx context.Context, kind string, groupID int64) error {
	if groupID == 0 {
		return nil
	}
	group, err := repo.GetMediaGroupByID(ctx, s.db, groupID)
	if err != nil || group.Kind != kind {
		return ErrInvalidGroup
	}
	return nil
}

// groupNameOf 单个分组名(富化出参用,查不到回空串)。
func (s *Service) groupNameOf(ctx context.Context, id int64) string {
	group, err := repo.GetMediaGroupByID(ctx, s.db, id)
	if err != nil {
		return ""
	}
	return group.Name
}

// logGroupFailed 分组操作失败埋点(业务失败也记,便于运营排查)。
func (s *Service) logGroupFailed(ctx context.Context, action, resourceID, description string) {
	oplog.Failed(ctx, s.db, oplog.Entry{
		Action: action, Resource: "media_group", ResourceID: resourceID, Description: description,
	}, "")
}

// validateGroupKind 分组仅覆盖契约中的 image / video 两类。
func validateGroupKind(kind string) error {
	if kind != KindImage && kind != KindVideo {
		return ErrInvalidType
	}
	return nil
}

// validateGroupName 分组名非空且不超过上限。
func validateGroupName(name string) error {
	if name == "" || utf8.RuneCountInString(name) > GroupNameMaxLen {
		return ErrInvalidGroupName
	}
	return nil
}
