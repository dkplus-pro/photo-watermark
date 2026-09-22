import { Button, Card, Drawer, Message, Modal, Space, Table } from "@arco-design/web-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { MediaController } from "../../../api/controllers.gen";
import type { VideoAsset } from "../../../api/generated/cMSAdminAPI.schemas";
import { queryKeys } from "../../../api/queryKeys";
import AuthGate from "../../../components/auth-gate";
import MediaGroupPanel from "../../../components/media-group-panel";
import MediaMoveGroupModal from "../../../components/media-move-group-modal";
import MediaUploadModal from "../../../components/media-upload-modal";
import PageContainer from "../../../components/page-container";
import { useFileURL } from "../../../hooks/use-file-url";
import { useTableQuery } from "../../../hooks/use-table-query";

// 视频管理:左侧分组栏 + 右侧列表(上传/内嵌播放/移动分组/删除,阶段 13)。
// 查询/分页对齐 UI 规范(docs/admin.md);groupId 口径:不传=全部,0=未分组。
export default function VideosPage() {
  const queryClient = useQueryClient();
  const [uploadVisible, setUploadVisible] = useState(false);
  const [playing, setPlaying] = useState<VideoAsset | null>(null);
  const [moveTarget, setMoveTarget] = useState<VideoAsset | null>(null);
  const [groupId, setGroupId] = useState<number | undefined>(undefined);

  const { page, pageSize, pagination, setTotal, resetPage } = useTableQuery();

  const listQuery = useQuery({
    queryKey: queryKeys.media.videos(page, pageSize, groupId),
    queryFn: () => MediaController.listVideos({ page, pageSize, groupId })
  });

  useEffect(() => {
    setTotal(listQuery.data?.total ?? 0);
  }, [listQuery.data?.total, setTotal]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => MediaController.deleteVideo(id),
    onSuccess: () => {
      Message.success("视频已删除");
      void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
    }
  });

  const deleteVideo = (video: VideoAsset) => {
    Modal.confirm({
      title: "删除确认",
      content: `确定删除视频 ${video.title} 吗?`,
      onOk: () => deleteMutation.mutateAsync(video.id)
    });
  };

  // 切换分组回第 1 页(分组栏筛选,阶段 13)。
  const handleGroupChange = (next: number | undefined) => {
    setGroupId(next);
    resetPage();
  };

  const videos = listQuery.data?.list ?? [];

  const columns = [
    { title: "标题", dataIndex: "title" },
    {
      title: "分组",
      dataIndex: "groupName",
      width: 140,
      render: (value: string) => value || "未分组"
    },
    {
      title: "大小",
      dataIndex: "size",
      width: 110,
      render: (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`
    },
    {
      title: "操作",
      width: 260,
      render: (_: unknown, record: VideoAsset) => (
        <Space>
          <Button size="mini" onClick={() => setPlaying(record)}>
            播放
          </Button>
          <AuthGate permission="media:video:update">
            <Button size="mini" onClick={() => setMoveTarget(record)}>
              移动分组
            </Button>
          </AuthGate>
          <AuthGate permission="media:video:delete">
            <Button size="mini" status="danger" onClick={() => deleteVideo(record)}>
              删除
            </Button>
          </AuthGate>
        </Space>
      )
    }
  ];

  return (
    <PageContainer
      extra={
        <AuthGate permission="media:video:upload">
          <Button type="primary" onClick={() => setUploadVisible(true)}>
            上传视频
          </Button>
        </AuthGate>
      }
    >
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <MediaGroupPanel kind="video" value={groupId} onChange={handleGroupChange} />

        <Card style={{ flex: 1, minWidth: 0 }}>
          <Table
            rowKey="id"
            loading={listQuery.isPending}
            columns={columns}
            data={videos}
            pagination={pagination}
          />
        </Card>
      </div>

      <Drawer
        width={640}
        visible={playing !== null}
        onCancel={() => setPlaying(null)}
        footer={null}
        title={playing?.title}
      >
        {playing ? <VideoPlayer video={playing} /> : null}
      </Drawer>

      <MediaUploadModal
        kind="video"
        visible={uploadVisible}
        onClose={() => setUploadVisible(false)}
      />
      <MediaMoveGroupModal kind="video" asset={moveTarget} onClose={() => setMoveTarget(null)} />
    </PageContainer>
  );
}

function VideoPlayer({ video }: { video: VideoAsset }) {
  const url = useFileURL(video.fileId, video.url);
  if (!url) {
    return <div style={{ color: "var(--color-text-3)" }}>加载中…</div>;
  }
  return <video src={url} controls style={{ width: "100%" }} />;
}
