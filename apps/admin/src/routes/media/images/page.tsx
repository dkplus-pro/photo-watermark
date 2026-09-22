import {
  Button,
  Card,
  Image as ArcoImage,
  Message,
  Modal,
  Pagination,
  Space
} from "@arco-design/web-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { MediaController } from "../../../api/controllers.gen";
import type { ImageAsset } from "../../../api/generated/cMSAdminAPI.schemas";
import { queryKeys } from "../../../api/queryKeys";
import AuthGate from "../../../components/auth-gate";
import MediaGroupPanel from "../../../components/media-group-panel";
import MediaMoveGroupModal from "../../../components/media-move-group-modal";
import MediaUploadModal from "../../../components/media-upload-modal";
import PageContainer from "../../../components/page-container";
import { useFileURL } from "../../../hooks/use-file-url";
import { useTableQuery } from "../../../hooks/use-table-query";

// 图片管理:左侧分组栏 + 右侧网格缩略图(上传/预览大图/移动分组/删除,阶段 13)。
// 查询/分页对齐 UI 规范(docs/admin.md);groupId 口径:不传=全部,0=未分组。
export default function ImagesPage() {
  const queryClient = useQueryClient();
  const [uploadVisible, setUploadVisible] = useState(false);
  const [moveTarget, setMoveTarget] = useState<ImageAsset | null>(null);
  const [groupId, setGroupId] = useState<number | undefined>(undefined);

  const { page, pageSize, pagination, setTotal, resetPage } = useTableQuery();

  const listQuery = useQuery({
    queryKey: queryKeys.media.images(page, pageSize, groupId),
    queryFn: () => MediaController.listImages({ page, pageSize, groupId })
  });

  useEffect(() => {
    setTotal(listQuery.data?.total ?? 0);
  }, [listQuery.data?.total, setTotal]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => MediaController.deleteImage(id),
    onSuccess: () => {
      Message.success("图片已删除");
      void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
    }
  });

  const deleteImage = (image: ImageAsset) => {
    Modal.confirm({
      title: "删除确认",
      content: `确定删除图片 ${image.title} 吗?`,
      onOk: () => deleteMutation.mutateAsync(image.id)
    });
  };

  // 切换分组回第 1 页(分组栏筛选,阶段 13)。
  const handleGroupChange = (next: number | undefined) => {
    setGroupId(next);
    resetPage();
  };

  const images = listQuery.data?.list ?? [];

  return (
    <PageContainer
      extra={
        <AuthGate permission="media:image:upload">
          <Button type="primary" onClick={() => setUploadVisible(true)}>
            上传图片
          </Button>
        </AuthGate>
      }
    >
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <MediaGroupPanel kind="image" value={groupId} onChange={handleGroupChange} />

        <Card style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 16
            }}
          >
            {images.map((image) => (
              <ImageCard
                key={image.id}
                image={image}
                onMove={setMoveTarget}
                onDelete={deleteImage}
              />
            ))}
          </div>
          {images.length === 0 && !listQuery.isPending ? (
            <div style={{ color: "var(--color-text-3)", textAlign: "center", padding: "40px 0" }}>
              暂无图片,点击右上角上传
            </div>
          ) : null}

          {/* 全量分页(总数 + 每页数量切换 + 跳页),经 use-table-query 统一编排。 */}
          <Space style={{ marginTop: 16, justifyContent: "flex-end", width: "100%" }}>
            <Pagination {...pagination} />
          </Space>
        </Card>
      </div>

      <MediaUploadModal
        kind="image"
        visible={uploadVisible}
        onClose={() => setUploadVisible(false)}
      />
      <MediaMoveGroupModal kind="image" asset={moveTarget} onClose={() => setMoveTarget(null)} />
    </PageContainer>
  );
}

interface ImageCardProps {
  image: ImageAsset;
  onMove: (image: ImageAsset) => void;
  onDelete: (image: ImageAsset) => void;
}

function ImageCard({ image, onMove, onDelete }: ImageCardProps) {
  const url = useFileURL(image.fileId, image.url);

  return (
    <div
      style={{
        border: "1px solid var(--color-fill-3)",
        borderRadius: 8,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 8
      }}
    >
      {/* Arco Image 自带点击预览大图 */}
      <ArcoImage
        src={url ?? ""}
        width="100%"
        height={120}
        style={{ objectFit: "cover", borderRadius: 4 }}
        title={image.title}
      />
      <div
        style={{ fontSize: 12, color: "var(--color-text-2)", wordBreak: "break-all" }}
        title={image.origName}
      >
        {image.title}
        {image.width && image.height ? `(${image.width}×${image.height})` : ""}
      </div>
      {image.groupName ? (
        <div style={{ fontSize: 12, color: "var(--color-text-3)" }}>分组:{image.groupName}</div>
      ) : null}
      <Space size={8}>
        <AuthGate permission="media:image:update">
          <Button size="mini" onClick={() => onMove(image)}>
            移动分组
          </Button>
        </AuthGate>
        <AuthGate permission="media:image:delete">
          <Button size="mini" status="danger" onClick={() => onDelete(image)}>
            删除
          </Button>
        </AuthGate>
      </Space>
    </div>
  );
}
