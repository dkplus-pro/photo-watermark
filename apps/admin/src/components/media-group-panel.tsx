import { Button, Card, Input, Message, Modal, Typography } from "@arco-design/web-react";
import { IconDelete, IconEdit, IconPlus } from "@arco-design/web-react/icon";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { MediaController } from "../api/controllers.gen";
import type { MediaGroup, MediaGroupKind } from "../api/generated/cMSAdminAPI.schemas";
import { queryKeys } from "../api/queryKeys";
import AuthGate from "./auth-gate";
import { useMediaGroups } from "../hooks/use-media-groups";

interface MediaGroupPanelProps {
  /** 分组所属媒体类型(图片 / 视频各一份列表)。 */
  kind: MediaGroupKind;
  /** 当前选中分组:不传(undefined)=全部,0=未分组,>0=分组 ID。 */
  value: number | undefined;
  /** 切换分组(页面侧负责重置回第 1 页)。 */
  onChange: (groupId: number | undefined) => void;
}

const PANEL_WIDTH = 208;

// 媒体分组栏(图片 / 视频页共用,见 docs/admin-enhancement-plan.md 阶段 13):
// 全部 / 未分组 / 各分组(带 mediaCount 计数)+ 行内重命名/删除 + 底部新建分组。
// 分组管理操作按权限码 media:group:create|update|delete 置灰(AuthGate);
// 整栏依赖 media:group:list,无权限时不渲染(见 use-media-groups)。
export default function MediaGroupPanel({ kind, value, onChange }: MediaGroupPanelProps) {
  const queryClient = useQueryClient();
  const groupsQuery = useMediaGroups(kind);
  const groups = groupsQuery.data?.list ?? [];
  // null=关闭;{ group: null }=新建;{ group }=重命名。
  const [editing, setEditing] = useState<{ group: MediaGroup | null } | null>(null);

  const invalidateMedia = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => MediaController.deleteMediaGroup(id),
    onSuccess: invalidateMedia
  });

  // 选中的分组被删除后(列表里已不存在),回退到"全部"。
  useEffect(() => {
    if (value !== undefined && value !== 0 && !groups.some((group) => group.id === value)) {
      onChange(undefined);
    }
  }, [groups, value, onChange]);

  const deleteGroup = (group: MediaGroup) => {
    Modal.confirm({
      title: "删除分组",
      content: `删除分组「${group.name}」后,组内 ${group.mediaCount} 个资源将移回未分组,确定删除吗?`,
      onOk: async () => {
        await deleteMutation.mutateAsync(group.id);
        Message.success("分组已删除");
      }
    });
  };

  const renderRow = (options: {
    key: string | number;
    label: string;
    count?: number;
    group?: MediaGroup;
    selected: boolean;
  }) => (
    <div
      key={options.key}
      onClick={() =>
        onChange(options.group ? options.group.id : options.key === "ungrouped" ? 0 : undefined)
      }
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 4,
        padding: "6px 8px",
        borderRadius: 4,
        cursor: "pointer",
        background: options.selected ? "var(--color-fill-2)" : "transparent"
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {options.label}
      </span>
      {options.count !== undefined ? (
        <Typography.Text type="secondary">{options.count}</Typography.Text>
      ) : null}
      {options.group ? (
        <span style={{ flexShrink: 0 }}>
          <AuthGate permission="media:group:update">
            <Button
              size="mini"
              icon={<IconEdit />}
              onClick={(event) => {
                event.stopPropagation();
                setEditing({ group: options.group ?? null });
              }}
            />
          </AuthGate>
          <AuthGate permission="media:group:delete">
            <Button
              size="mini"
              status="danger"
              icon={<IconDelete />}
              onClick={(event) => {
                event.stopPropagation();
                if (options.group) {
                  deleteGroup(options.group);
                }
              }}
            />
          </AuthGate>
        </span>
      ) : null}
    </div>
  );

  return (
    <Card
      size="small"
      title="分组"
      style={{ width: PANEL_WIDTH, flexShrink: 0 }}
      loading={groupsQuery.isPending}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {renderRow({ key: "all", label: "全部", selected: value === undefined })}
        {renderRow({ key: "ungrouped", label: "未分组", selected: value === 0 })}
        {groups.map((group) =>
          renderRow({
            key: group.id,
            label: group.name,
            count: group.mediaCount,
            group,
            selected: value === group.id
          })
        )}
      </div>
      <AuthGate permission="media:group:create">
        <Button
          long
          type="dashed"
          icon={<IconPlus />}
          style={{ marginTop: 8 }}
          onClick={() => setEditing({ group: null })}
        >
          新建分组
        </Button>
      </AuthGate>

      {editing ? (
        <GroupEditModal
          kind={kind}
          group={editing.group}
          onClose={() => setEditing(null)}
          onSuccess={invalidateMedia}
        />
      ) : null}
    </Card>
  );
}

interface GroupEditModalProps {
  kind: MediaGroupKind;
  /** null 表示新建,否则为重命名目标。 */
  group: MediaGroup | null;
  onClose: () => void;
  onSuccess: () => void;
}

// 新建 / 重命名共用一个简单弹窗(单字段,符合 UI 规范"简单表单 = Modal")。
function GroupEditModal({ kind, group, onClose, onSuccess }: GroupEditModalProps) {
  const isRename = group !== null;
  const [name, setName] = useState(group?.name ?? "");

  const saveMutation = useMutation({
    mutationFn: (nextName: string) =>
      isRename
        ? MediaController.updateMediaGroup(group.id, { name: nextName })
        : MediaController.createMediaGroup({ kind, name: nextName }),
    onSuccess: () => {
      Message.success(isRename ? "分组已重命名" : "分组已创建");
      onSuccess();
      onClose();
    }
    // 重名 409 等错误提示由 client.ts 拦截器统一弹出
  });

  return (
    <Modal
      title={isRename ? "重命名分组" : "新建分组"}
      visible
      confirmLoading={saveMutation.isPending}
      onOk={() => {
        const trimmed = name.trim();
        if (!trimmed) {
          Message.warning("请输入分组名称");
          return;
        }
        saveMutation.mutate(trimmed);
      }}
      onCancel={onClose}
      unmountOnExit
    >
      <Input
        value={name}
        maxLength={64}
        showWordLimit
        placeholder="请输入分组名称(64 字以内)"
        onChange={setName}
        onPressEnter={() => {
          if (name.trim()) {
            saveMutation.mutate(name.trim());
          }
        }}
      />
    </Modal>
  );
}
