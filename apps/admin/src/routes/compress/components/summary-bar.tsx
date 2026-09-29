import { Button, Typography } from "@arco-design/web-react";
import { IconDelete, IconDownload } from "@arco-design/web-react/icon";
import { memo } from "react";

import { formatByteSize } from "../../../utils/file-name";
import { savingsLabelOf } from "../../../utils/compress/format";

import "./summary-bar.css";

/**
 * 吸底汇总栏:整批压缩结果的一句话结论 + 打包下载 / 清空两个动作。
 * 吸底范式与导出页操作条一致(sticky + .app-content:has() 收内边距,见 index.css)。
 */

export interface SummaryBarProps {
  doneCount: number;
  totalCount: number;
  failedCount: number;
  originalBytes: number;
  compressedBytes: number;
  packing: boolean;
  onDownloadZip(): void;
  onClear(): void;
}

function SummaryBarImpl({
  doneCount,
  totalCount,
  failedCount,
  originalBytes,
  compressedBytes,
  packing,
  onDownloadZip,
  onClear
}: SummaryBarProps) {
  const saving = savingsLabelOf(originalBytes, compressedBytes);
  const savingText = saving && saving !== "未减小" ? `节省 ${saving.replace("-", "")}` : null;
  return (
    <div className="compress-actions">
      <div className="compress-actions-summary">
        <Typography.Text>
          已完成 {String(doneCount)}/{String(totalCount)} 张
          {failedCount > 0 ? ` · ${String(failedCount)} 张失败` : ""}
        </Typography.Text>
        {doneCount > 0 ? (
          <Typography.Text type="secondary">
            {formatByteSize(originalBytes)} → {formatByteSize(compressedBytes)}
            {savingText ? `(${savingText})` : ""}
          </Typography.Text>
        ) : null}
      </div>
      <div className="compress-actions-buttons">
        <Button
          type="primary"
          icon={<IconDownload />}
          loading={packing}
          disabled={doneCount === 0}
          onClick={onDownloadZip}
        >
          打包下载 ZIP
        </Button>
        <Button status="danger" icon={<IconDelete />} onClick={onClear}>
          清空
        </Button>
      </div>
    </div>
  );
}

export const SummaryBar = memo(SummaryBarImpl);
export default SummaryBar;
