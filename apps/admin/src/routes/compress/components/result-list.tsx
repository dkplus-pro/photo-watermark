import { Button, Tag, Typography } from "@arco-design/web-react";
import { IconDelete, IconDownload, IconLoading } from "@arco-design/web-react/icon";
import { useMemoizedFn } from "ahooks";
import { memo } from "react";

import { useObjectUrl } from "../../../hooks/use-object-url";
import type { CompressFileEntry } from "../../../store/compress";
import { formatByteSize, SIZE_UNAVAILABLE } from "../../../utils/file-name";
import { savingsLabelOf } from "../../../utils/compress/format";

import "./result-list.css";

/**
 * 压缩结果列表:一行一张图,状态(排队/压缩中/完成/失败)与体积变化一目了然。
 *
 * 缩略图纪律与导出页照片卡一致:显示优先 `entry.thumb`(准备阶段产的小图),
 * object URL 直指原图会让浏览器为一格 64px 的缩略位解码整幅位图;
 * 缩略图没产出时退回原图直显。每行单独持有 useObjectUrl,删除/清空/卸载三条路径
 * 都能精确 revoke 自己那条 URL。
 */

export interface ResultListProps {
  entries: readonly CompressFileEntry[];
  onDownload(result: NonNullable<CompressFileEntry["result"]>): void;
  onRemove(id: string): void;
}

interface RowProps {
  entry: CompressFileEntry;
  touchFriendly: boolean;
  onDownload: ResultListProps["onDownload"];
  onRemove: (id: string) => void;
}

/** 元信息行:源图体积 +(探测出来才有的)尺寸。width/height 的 0 是「尚未探测」,不拼进文案。 */
const sourceMetaOf = (entry: CompressFileEntry): string => {
  const size = formatByteSize(entry.size);
  return entry.width > 0 && entry.height > 0
    ? `${size} · ${String(entry.width)}×${String(entry.height)}`
    : size;
};

function StatusArea({ entry }: { entry: CompressFileEntry }) {
  if (entry.status === "queued") {
    return <Tag color="gray">排队中</Tag>;
  }
  if (entry.status === "working") {
    return (
      <span className="compress-row-working">
        <IconLoading spin />
        <span>压缩中</span>
      </span>
    );
  }
  if (entry.status === "failed") {
    return (
      <span className="compress-row-failed">
        <Tag color="red">失败</Tag>
        <Typography.Text
          type="secondary"
          className="compress-row-failed-message"
          ellipsis={{ rows: 2 }}
        >
          {entry.errorMessage ?? "压缩失败"}
        </Typography.Text>
      </span>
    );
  }
  const result = entry.result;
  if (!result) return <Tag color="gray">排队中</Tag>;
  const saving = savingsLabelOf(entry.size, result.size);
  return (
    <span className="compress-row-result">
      <span className="compress-row-sizes">
        {formatByteSize(entry.size)} → {formatByteSize(result.size)}
      </span>
      {/* 节省比例是「这张图压得值不值」的结论:有收益绿色标签,无收益(含变大)中性提示。 */}
      {saving && saving !== "未减小" ? (
        <Tag color="green">{saving}</Tag>
      ) : (
        <Tag color="gray">{saving ?? SIZE_UNAVAILABLE}</Tag>
      )}
    </span>
  );
}

const ResultRow = memo(function ResultRow({
  entry,
  touchFriendly,
  onDownload,
  onRemove
}: RowProps) {
  const url = useObjectUrl(entry.thumb ?? entry.file);
  const handleDownload = useMemoizedFn(() => {
    if (entry.result) onDownload(entry.result);
  });
  return (
    <li className="compress-row">
      <div className="compress-row-media">
        {url ? (
          <img className="compress-row-thumb" src={url} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="compress-row-thumb-placeholder">无法显示</span>
        )}
      </div>
      <div className="compress-row-info">
        <Typography.Text className="compress-row-name" ellipsis={{ showTooltip: true }}>
          {entry.baseName}
        </Typography.Text>
        <Typography.Text type="secondary" className="compress-row-meta">
          {sourceMetaOf(entry)}
        </Typography.Text>
      </div>
      <div className="compress-row-status">
        <StatusArea entry={entry} />
      </div>
      <div className="compress-row-actions">
        {entry.result ? (
          <Button
            type="primary"
            size="small"
            icon={<IconDownload />}
            aria-label={`下载 ${entry.baseName}`}
            className={touchFriendly ? "compress-row-button--touch" : undefined}
            onClick={handleDownload}
          >
            下载
          </Button>
        ) : null}
        <Button
          size="small"
          status="danger"
          icon={<IconDelete />}
          aria-label={`移除 ${entry.baseName}`}
          className={touchFriendly ? "compress-row-button--touch" : undefined}
          onClick={() => onRemove(entry.id)}
        />
      </div>
    </li>
  );
});

export function ResultList({ entries, onDownload, onRemove }: ResultListProps) {
  return (
    <ul className="compress-list">
      {entries.map((entry) => (
        <ResultRow
          key={entry.id}
          entry={entry}
          touchFriendly={false}
          onDownload={onDownload}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}

export default ResultList;
