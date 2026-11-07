import { IconPlus, IconUpload } from "@douyinfe/semi-icons";
import { Button, Typography, Upload } from "@douyinfe/semi-ui";
import type { UploadProps } from "@douyinfe/semi-ui/lib/es/upload";
import { useMemoizedFn } from "ahooks";
import { memo } from "react";

import { useIsMobile } from "../../../hooks/use-responsive";

import "./drop-zone.css";

/**
 * 拖拽选图区(压缩页的入口,tinypng 式大拖拽区)。
 *
 * 与导出页 image-picker 同一条 Upload 用法纪律:Semi 的 `Upload` 只当**取文件的触发器**
 * (它负责渲染 `<input type="file" multiple>` 与拖拽事件),文件列表的事实源在 store/compress;
 * `uploadTrigger="custom"` 且不给 `action`,Semi 因此不建任何请求(本站无服务端)。
 * accept 里必须显式追加 `.heic/.heif`:Semi 对 accept 做的是 JS 硬过滤(不只挂在 input 上),
 * heic 的 `file.type` 常为空串、过不了 `image/*` 的 MIME 匹配,会被选择期静默丢弃;
 * 追加扩展名后这类图仍能进来,在解码期作为单张失败呈现(与导出页同口径)。
 *
 * 两种形态:
 * - hero(列表为空):大拖拽区,桌面可拖可点,移动端换成主按钮(触屏没有「拖拽」动作);
 * - compact(已有列表):一行细条,继续添加不抢视觉。
 */

export interface DropZoneProps {
  compact: boolean;
  onAdd(files: readonly File[]): void;
}

/** 传给 Semi 的 accept:`image/*` 加 heic 扩展名,空 MIME 的 heic 才能过 JS 过滤。 */
const IMAGE_ACCEPT: NonNullable<UploadProps["accept"]> = "image/*,.heic,.heif";

type UploadItem = NonNullable<UploadProps["fileList"]>[number];

function DropZoneImpl({ compact, onAdd }: DropZoneProps) {
  const isMobile = useIsMobile();

  // Semi 每选中一个文件回调一次(onChange 逐文件触发,currentFile 即本次新增的那一个),
  // 多选是 N 次 onAdd,store 的 addFiles 逐次追加并按签名判重。
  const handleUploadChange = useMemoizedFn(({ currentFile }: { currentFile: UploadItem }) => {
    if (currentFile?.fileInstance) onAdd([currentFile.fileInstance]);
  });

  if (compact) {
    return (
      <div className="compress-dropzone compress-dropzone--compact">
        <Upload
          accept={IMAGE_ACCEPT}
          multiple
          draggable={!isMobile}
          uploadTrigger="custom"
          showUploadList={false}
          onChange={handleUploadChange}
        >
          <Button type="primary" theme="solid" icon={<IconPlus />} size="small">
            继续添加
          </Button>
        </Upload>
        <Typography.Text type="secondary" className="compress-dropzone-compact-tip">
          还可以把图片拖进来
        </Typography.Text>
      </div>
    );
  }

  return (
    <Upload
      className="compress-dropzone-upload"
      accept={IMAGE_ACCEPT}
      multiple
      draggable={!isMobile}
      uploadTrigger="custom"
      showUploadList={false}
      onChange={handleUploadChange}
    >
      {isMobile ? (
        <Button
          className="compress-dropzone-mobile-trigger"
          type="primary"
          theme="solid"
          size="large"
          icon={<IconUpload />}
        >
          选择图片
        </Button>
      ) : (
        <div className="compress-dropzone-hero">
          <IconUpload className="compress-dropzone-hero-icon" size="extra-large" />
          <div className="compress-dropzone-hero-title">拖放图片到此处,或点击选择</div>
          <Typography.Text type="secondary">
            支持 JPG / PNG / WebP / GIF / AVIF,可一次多选
          </Typography.Text>
        </div>
      )}
    </Upload>
  );
}

export const DropZone = memo(DropZoneImpl);
export default DropZone;
