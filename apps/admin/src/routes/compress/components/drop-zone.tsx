import { Button, Typography, Upload } from "@arco-design/web-react";
import type { UploadProps } from "@arco-design/web-react";
import { IconPlus, IconUpload } from "@arco-design/web-react/icon";
import { useMemoizedFn } from "ahooks";
import { memo } from "react";

import { useIsMobile } from "../../../hooks/use-responsive";

import "./drop-zone.css";

/**
 * 拖拽选图区(压缩页的入口,tinypng 式大拖拽区)。
 *
 * 与导出页 image-picker 同一条 Upload 用法纪律:arco 的 `Upload` 只当**取文件的触发器**
 * (它负责渲染 `<input type="file" multiple>` 与拖拽事件),文件列表的事实源在 store/compress;
 * `autoUpload={false}` 且不给 `action`,arco 因此不建任何请求(本站无服务端)。
 * `accept.strict` 必须关:开着时 arco 按后缀把 `file.type` 为空的 heic 直接丢弃,
 * 而这类图要收进来、在解码期作为单张失败呈现(与导出页同口径)。
 *
 * 两种形态:
 * - hero(列表为空):大拖拽区,桌面可拖可点,移动端换成主按钮(触屏没有「拖拽」动作);
 * - compact(已有列表):一行细条,继续添加不抢视觉。
 */

export interface DropZoneProps {
  compact: boolean;
  onAdd(files: readonly File[]): void;
}

/** 传给 arco 的 accept 形状:对象形态才能同时带上 `strict: false`。 */
const IMAGE_ACCEPT: UploadProps["accept"] = { type: "image/*", strict: false };

type UploadItem = NonNullable<UploadProps["fileList"]>[number];

function DropZoneImpl({ compact, onAdd }: DropZoneProps) {
  const isMobile = useIsMobile();

  // arco 每选中一个文件回调一次(第二参即本次新增的那一个),多选是 N 次 onAdd,
  // store 的 addFiles 逐次追加并按签名判重。
  const handleUploadChange = useMemoizedFn((_fileList: UploadItem[], file: UploadItem) => {
    if (file.originFile) onAdd([file.originFile]);
  });

  if (compact) {
    return (
      <div className="compress-dropzone compress-dropzone--compact">
        <Upload
          accept={IMAGE_ACCEPT}
          multiple
          drag={!isMobile}
          autoUpload={false}
          showUploadList={false}
          onChange={handleUploadChange}
        >
          <Button type="primary" icon={<IconPlus />} size="small">
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
      drag={!isMobile}
      autoUpload={false}
      showUploadList={false}
      onChange={handleUploadChange}
    >
      {isMobile ? (
        <Button
          className="compress-dropzone-mobile-trigger"
          type="primary"
          size="large"
          icon={<IconUpload />}
        >
          选择图片
        </Button>
      ) : (
        <div className="compress-dropzone-hero">
          <IconUpload className="compress-dropzone-hero-icon" />
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
