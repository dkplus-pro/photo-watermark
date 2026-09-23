import { Alert, Button, Card, Space, Typography, Upload } from "@arco-design/web-react";
import type { UploadProps } from "@arco-design/web-react";
import { IconDelete, IconUpload } from "@arco-design/web-react/icon";
import { useMemoizedFn } from "ahooks";
import sumBy from "lodash/sumBy";

import { useObjectUrl } from "../../../../../hooks/use-object-url";
import { useIsMobile } from "../../../../../hooks/use-responsive";
import type { ExportFileEntry } from "../../../../../store/export";
import { formatByteSize } from "../../../../../utils/file-name";

import "./components.css";

/**
 * 照片选择器(阶段 11)。
 *
 * 为什么不是 arco `Upload` 直接搞定:`Upload` 的文件列表是它自己那套 `uid + status + percent`
 * 的**上传中**模型,而本站没有上传——已选照片的唯一事实源是 `store/export` 的
 * `ExportFileEntry[]`(带 EXIF、源图尺寸、判重签名)。两套模型硬拼会出现「谁说了算」的分裂:
 * 删一张要同时改 store 和 arco 内部列表。所以这里只把 `Upload` 当**取文件的触发器**
 * (它负责渲染那个 iOS 上唯一可靠的 `<input type="file" multiple>` 与拖拽事件),
 * 已选列表一律由本组件按 store 数据自绘。
 *
 * 判重与非图片拒收都已在 store 的 `addFiles` 里做完,本组件不重复判定;`accept.strict`
 * 显式关掉也是如此——开着严格模式时 arco 会按后缀把 `file.type` 为空的 heic 直接丢弃,
 * 而 D7 要求这种图**收进来**、在解码期作为单张失败呈现。关掉后原生 input 的
 * `accept="image/*"` 仍给桌面选图器做默认筛选,拖拽进来的则原样交给 store。
 */

export interface ImagePickerProps {
  files: ExportFileEntry[];
  disabled: boolean;
  /** 移动端软提示阈值；files.length 超过它时组件显示一条非阻断提示（D19） */
  softLimit: number;
  onAdd(files: readonly File[]): void;
  onRemove(id: string): void;
  onClear(): void;
}

/** 传给 arco 的 accept 形状:对象形态才能同时带上 `strict: false`(理由见文件头注释)。 */
const IMAGE_ACCEPT: UploadProps["accept"] = { type: "image/*", strict: false };

/** arco 的 `UploadItem` 未从包根导出(`es/index.d.ts` 只 re-export 了 `UploadProps`),按 props 派生。 */
type UploadItem = NonNullable<UploadProps["fileList"]>[number];

const DRAGGER_TIP = "支持 jpg / png / webp / avif / heic,一次可多选";

/** D19 的软提示文案:`{count}` 由 props 给,组件不写死张数。 */
const softLimitHint = (limit: number): string =>
  `一次选择 ${String(limit)} 张以上会较慢且占内存, 建议改用更小的输出档位。`;

/**
 * 是否越过软提示阈值。`softLimit` 非正数或非有限值(页面传错、持久化数据被改坏)时**不提示**:
 * 「0 张以上」这种句子对用户没有信息量,宁可不显示也别用一句怪文案打断操作。
 */
const isOverSoftLimit = (count: number, softLimit: number): boolean =>
  Number.isFinite(softLimit) && softLimit > 0 && count > softLimit;

/**
 * 列表项的一行元信息:体积 +(探测出来才有的)源图尺寸。
 * `width/height` 的 0 是 store 里「尚未探测」的显式语义,不是尺寸 0,所以零值一律不拼进文案
 * ——一行「1.2 MB · 0×0」会让用户以为自己的照片是坏的。
 */
const itemMetaOf = (entry: ExportFileEntry): string =>
  entry.width > 0 && entry.height > 0
    ? `${formatByteSize(entry.size)} · ${String(entry.width)}×${String(entry.height)}`
    : formatByteSize(entry.size);

interface PhotoThumbProps {
  entry: ExportFileEntry;
  disabled: boolean;
  /** 移动端把删除按钮撑到 44px 触摸目标(AGENTS.md 第 7 节) */
  touchFriendly: boolean;
  onRemove: (id: string) => void;
}

/**
 * 单张已选照片的缩略项。
 *
 * 为什么单独抽一个组件而不是在 `.map()` 里调 `useObjectUrl`:hooks 不能在循环中调用。
 * 更关键的是**生命周期归属**——`useObjectUrl` 的语义是「谁创建谁释放」,只有每张图各自持有一个
 * hook,才能在「这一张被删」「整表清空」「组件卸载」三条路径上精确 revoke 它那一条 URL,
 * 全程不需要父组件攒 URL 数组手工回收(手写 revoke 正是 Safari 空白图的成因,D22)。
 */
function PhotoThumb({ entry, disabled, touchFriendly, onRemove }: PhotoThumbProps) {
  const url = useObjectUrl(entry.file);
  return (
    <li className="image-picker-item">
      <div className="image-picker-item-media">
        {url ? (
          <img className="image-picker-item-thumb" src={url} alt="" loading="lazy" />
        ) : (
          // 生成失败(隐私模式、配额耗尽)只丢这一张的缩略,这张图照样参与导出。
          <span className="image-picker-item-placeholder">无法显示</span>
        )}
        <Button
          className={
            touchFriendly
              ? "image-picker-item-remove image-picker-item-remove--touch"
              : "image-picker-item-remove"
          }
          shape="circle"
          size="mini"
          status="danger"
          icon={<IconDelete />}
          aria-label={`移除 ${entry.baseName}`}
          disabled={disabled}
          onClick={() => onRemove(entry.id)}
        />
      </div>
      <Typography.Text className="image-picker-item-name" ellipsis={{ showTooltip: true }}>
        {entry.baseName}
      </Typography.Text>
      <div className="image-picker-item-size">{itemMetaOf(entry)}</div>
    </li>
  );
}

export function ImagePicker({
  files,
  disabled,
  softLimit,
  onAdd,
  onRemove,
  onClear
}: ImagePickerProps) {
  const isMobile = useIsMobile();
  const totalBytes = sumBy(files, "size");
  // D19 只讲移动端(桌面内存预算是移动的 4 倍,同样张数不构成风险),故按断点显示;
  // 阈值本身由 props 给(页面传 store 的 MOBILE_SOFT_LIMIT),组件不写死张数。
  const showSoftLimitHint = isMobile && isOverSoftLimit(files.length, softLimit);

  // arco 每选中一个文件回调一次(第二参即本次新增的那一个),多选因而是 N 次 onAdd:
  // store 的 addFiles 逐次追加并按签名判重,组件侧攒批只会多一处要测的状态。
  const handleUploadChange = useMemoizedFn((_fileList: UploadItem[], file: UploadItem) => {
    if (file.originFile) onAdd([file.originFile]);
  });

  return (
    <Card
      className={isMobile ? "image-picker image-picker--mobile" : "image-picker"}
      title="照片"
      extra={
        <Space>
          <Typography.Text type="secondary">
            已选 {files.length} 张 · {formatByteSize(totalBytes)}
          </Typography.Text>
          <Button size="small" onClick={onClear} disabled={disabled || files.length === 0}>
            清空
          </Button>
        </Space>
      }
    >
      {showSoftLimitHint ? (
        <Alert className="image-picker-hint" type="warning" content={softLimitHint(softLimit)} />
      ) : null}

      {/*
        触发区按端型切换(AGENTS.md 第 7 节:交互差异才用 hook,纯视觉差异走 @media):
        - 桌面 `drag`:交给 arco 的拖拽区,它自带 tabIndex + aria-label,拖放与点击共用一个入口;
        - 移动端 `drag={false}` + 自绘按钮:触屏没有「拖拽」这个动作,留着 arco 那句
          「点击或拖拽文件到此处上传」既是误导也是英文站点腔;真 `<button>` 同时白拿
          焦点态与 ≥44px 触摸目标(样式见 components.css 的 .image-picker-trigger)。
        两种形态底下都是同一个 `<input type="file" accept="image/*" multiple>`,iOS 上这是
        唯一可靠的选图入口。`autoUpload={false}` 且不给 `action`:arco 因此不建任何请求。
      */}
      <Upload
        className="image-picker-upload"
        accept={IMAGE_ACCEPT}
        multiple
        drag={!isMobile}
        tip={DRAGGER_TIP}
        autoUpload={false}
        showUploadList={false}
        disabled={disabled}
        onChange={handleUploadChange}
      >
        {isMobile ? (
          <Button className="image-picker-trigger" type="primary" icon={<IconUpload />}>
            选择照片
          </Button>
        ) : undefined}
      </Upload>

      {files.length === 0 ? (
        // 提示语跟着端型走:触屏上「拖进来」根本不成立。
        <p className="image-picker-empty">
          {isMobile
            ? "还没有选择照片, 点上方「选择照片」开始。"
            : "还没有选择照片: 点上方区域, 或把图片直接拖进来。"}
        </p>
      ) : (
        <ul className="image-picker-grid">
          {files.map((entry) => (
            <PhotoThumb
              key={entry.id}
              entry={entry}
              disabled={disabled}
              touchFriendly={isMobile}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

export default ImagePicker;
