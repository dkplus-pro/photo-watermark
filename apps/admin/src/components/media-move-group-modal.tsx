import { Message, Modal, Select } from "@arco-design/web-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { MediaController } from "../api/controllers.gen";
import type { MediaGroupKind } from "../api/generated/cMSAdminAPI.schemas";
import { queryKeys } from "../api/queryKeys";
import { useMediaGroups } from "../hooks/use-media-groups";

interface MediaMoveGroupModalProps {
  /** 分组所属媒体类型,决定调 moveImageGroup 还是 moveVideoGroup。 */
  kind: MediaGroupKind;
  /** 待移动资源(id/title/groupId),传 null 表示关闭。 */
  asset: { id: number; title: string; groupId: number } | null;
  onClose: () => void;
}

const UNGROUPED = 0;

// 移动分组弹窗(图片 / 视频页共用):选择目标分组,0=移出分组(未分组)。
// 权限由页面侧的入口按钮控制(复用各 kind 的 media:image|video:update,契约约定)。
export default function MediaMoveGroupModal({ kind, asset, onClose }: MediaMoveGroupModalProps) {
  const queryClient = useQueryClient();
  const groupsQuery = useMediaGroups(kind);
  const [targetGroupId, setTargetGroupId] = useState<number>(UNGROUPED);

  // 每次打开都按资源当前归属重置选择。
  useEffect(() => {
    if (asset) {
      setTargetGroupId(asset.groupId);
    }
  }, [asset]);

  const moveMutation = useMutation({
    mutationFn: (groupId: number) => {
      if (!asset) {
        return Promise.reject(new Error("no asset"));
      }
      return kind === "image"
        ? MediaController.moveImageGroup(asset.id, { groupId })
        : MediaController.moveVideoGroup(asset.id, { groupId });
    },
    onSuccess: () => {
      Message.success("移动成功");
      // 移动会同时改变两侧的列表归属与分组计数,统一按模块前缀失效。
      void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      onClose();
    }
    // 失败提示由 client.ts 拦截器统一弹出
  });

  const kindLabel = kind === "image" ? "图片" : "视频";

  return (
    <Modal
      title={`移动${kindLabel}`}
      visible={asset !== null}
      confirmLoading={moveMutation.isPending}
      onOk={() => moveMutation.mutate(targetGroupId)}
      onCancel={onClose}
      unmountOnExit
    >
      <div style={{ marginBottom: 8, wordBreak: "break-all" }}>
        {kindLabel}「{asset?.title}」移动到:
      </div>
      <Select
        style={{ width: "100%" }}
        value={targetGroupId}
        onChange={setTargetGroupId}
        notFoundContent={groupsQuery.isPending ? "加载中…" : "暂无分组"}
        options={[
          { label: "未分组", value: UNGROUPED },
          ...(groupsQuery.data?.list ?? []).map((group) => ({
            label: group.name,
            value: group.id
          }))
        ]}
      />
    </Modal>
  );
}
