import { Button, Message, Modal, Progress, Select, Space, Upload } from "@arco-design/web-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { MediaController } from "../api/controllers.gen";
import type { MediaGroupKind, UploadSession } from "../api/generated/cMSAdminAPI.schemas";
import { queryKeys } from "../api/queryKeys";
import { discardResumableSession, findResumableSession } from "../hooks/chunked-upload-resume";
import { useChunkedUpload } from "../hooks/use-chunked-upload";
import { useMediaGroups } from "../hooks/use-media-groups";

interface MediaUploadModalProps {
  kind: MediaGroupKind;
  visible: boolean;
  onClose: () => void;
}

const KIND_CONFIG: Record<
  MediaGroupKind,
  { title: string; accept: string; tip: string; multiple: boolean }
> = {
  image: {
    title: "上传图片",
    accept: "image/png,image/jpeg,image/gif,image/webp",
    tip: "支持 PNG / JPG / GIF / WebP,单张不超过 10MB",
    multiple: true
  },
  video: {
    title: "上传视频",
    accept: "video/mp4,video/webm,video/quicktime",
    tip: "支持 MP4 / WebM / MOV,单个不超过 2GB;大文件分片上传,中断后重选同一文件可从断点续传",
    multiple: false
  }
};

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// 视频分片上传区:选文件 → 识别断点(指纹命中未完成会话时弹"继续/重新上传")→ 自动分片上传,
// 展示总进度与暂停/继续/取消;完成后 Message 成功并失效媒体列表缓存。
function VideoUploadSection({
  accept,
  tip,
  groupId
}: {
  accept: string;
  tip: string;
  groupId: number | undefined;
}) {
  const queryClient = useQueryClient();
  const { state, start, pause, resume, cancel } = useChunkedUpload("video");
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isActive =
    state.status === "preparing" || state.status === "uploading" || state.status === "paused";

  const beginUpload = (file: File, resumeSession?: UploadSession) => {
    start(file, { groupId, resumeSession })
      .then((media) => {
        if (media && mountedRef.current) {
          Message.success(`视频「${media.origName}」已上传`);
          void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
        }
      })
      .catch(() => undefined); // 失败提示由 client.ts 拦截器统一弹出
  };

  const handleFileChosen = async (file: File) => {
    if (isActive) {
      return; // 上一支视频上传未结束前不允许再选
    }
    const resumable = await findResumableSession(file);
    if (!mountedRef.current) {
      return;
    }
    if (!resumable) {
      beginUpload(file);
      return;
    }
    if (resumable.uploadedIndexes.length >= resumable.chunkCount) {
      beginUpload(file, resumable); // 分片已齐全,续传后直接触发合并
      return;
    }
    const percent = Math.floor((resumable.uploadedIndexes.length / resumable.chunkCount) * 100);
    Modal.confirm({
      title: "发现未完成的视频上传",
      content: `「${file.name}」之前已上传 ${percent}%,是否继续?选择"重新上传"将放弃已传部分。`,
      okText: "继续上传",
      cancelText: "重新上传",
      onOk: () => beginUpload(file, resumable),
      onCancel: () => {
        void discardResumableSession(file, resumable).then(() => {
          if (mountedRef.current) {
            beginUpload(file);
          }
        });
      }
    });
  };

  const percent =
    state.totalBytes > 0 ? Math.floor((state.uploadedBytes / state.totalBytes) * 100) : 0;

  return (
    <Space direction="vertical" size="medium" style={{ width: "100%" }}>
      <Upload
        drag
        multiple={false}
        accept={accept}
        disabled={isActive}
        customRequest={(options) => {
          void handleFileChosen(options.file as File);
          options.onSuccess?.();
        }}
        tip={tip}
      />
      {state.status !== "idle" && state.status !== "completed" && state.status !== "cancelled" && (
        <div>
          <Progress
            percent={percent}
            status={state.status === "failed" ? "error" : "normal"}
            formatText={(p) =>
              `${p}% (${formatMB(state.uploadedBytes)}/${formatMB(state.totalBytes)})`
            }
          />
          <Space size="small" style={{ marginTop: 8 }}>
            {state.status === "uploading" ? (
              <Button size="small" onClick={pause}>
                暂停
              </Button>
            ) : state.status === "paused" ? (
              <Button size="small" type="primary" onClick={() => void resume()}>
                继续
              </Button>
            ) : null}
            {isActive && (
              <Button size="small" status="danger" onClick={cancel}>
                取消上传
              </Button>
            )}
          </Space>
          {state.status === "failed" && (
            <div style={{ marginTop: 8 }}>上传失败,重新选择同一文件可从断点继续。</div>
          )}
        </div>
      )}
    </Space>
  );
}

// 上传弹窗(图片 / 视频页共用):图片走 multipart 直传(≤10MB,可多选);
// 视频走分片上传(≤2GB,单文件),可选"分组"Select 两种方式都生效
// (图片在 multipart 字段,视频传给分片 init)。分组列表与分组栏共享同一 queryKey 缓存。
export default function MediaUploadModal({ kind, visible, onClose }: MediaUploadModalProps) {
  const queryClient = useQueryClient();
  const config = KIND_CONFIG[kind];
  const groupsQuery = useMediaGroups(kind);
  const [groupId, setGroupId] = useState<number | undefined>(undefined);

  // 每次打开重置分组选择。
  useEffect(() => {
    if (visible) {
      setGroupId(undefined);
    }
  }, [visible]);

  // 仅图片分支使用(视频已改走分片上传,见 VideoUploadSection)
  const uploadMutation = useMutation({
    mutationFn: (file: File) => MediaController.uploadImage({ file, groupId }),
    onSuccess: () => {
      Message.success("图片已上传");
      void queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
    }
    // 失败提示(类型/大小)由 client.ts 拦截器统一弹出
  });

  return (
    <Modal title={config.title} visible={visible} footer={null} onCancel={onClose} unmountOnExit>
      <Space direction="vertical" size="medium" style={{ width: "100%" }}>
        <Select
          placeholder="分组(不选为未分组)"
          allowClear
          style={{ width: "100%" }}
          value={groupId}
          onChange={setGroupId}
          loading={groupsQuery.isPending}
          notFoundContent={groupsQuery.isPending ? "加载中…" : "暂无分组"}
          options={(groupsQuery.data?.list ?? []).map((group) => ({
            label: group.name,
            value: group.id
          }))}
        />
        {kind === "video" ? (
          <VideoUploadSection accept={config.accept} tip={config.tip} groupId={groupId} />
        ) : (
          <Upload
            drag
            multiple={config.multiple}
            accept={config.accept}
            customRequest={(options) => {
              uploadMutation.mutate(options.file);
              options.onSuccess?.();
            }}
            tip={config.tip}
          />
        )}
      </Space>
    </Modal>
  );
}
