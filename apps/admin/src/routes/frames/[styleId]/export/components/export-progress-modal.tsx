import { Alert, Button, Modal, Progress, Result, Space, Typography } from "@arco-design/web-react";
import { useIsMobile } from "../../../../../hooks/use-responsive";
import { MOBILE_SOFT_LIMIT } from "../../../../../store/export";
import type { ExportStatus } from "../../../../../store/export";
import type { FrameFailure } from "../../../../../utils/frame/types";

import "../index.css";

/**
 * 导出进度弹框(阶段 13)。
 *
 * 纯受控组件:所有事实从 store 经 props 传进来,自己只做「状态 → 视图」的映射,
 * 不订阅 store、不碰流水线。这样取消/失败/迟到回报这些时序问题都归到页面一处去测。
 *
 * 两条硬口径:
 * - **exporting 期间不可逃避**:`maskClosable`/`escToExit`/`closable` 全关,唯一出口是「取消导出」。
 *   跑着几十张任务的流水线被一次误点遮罩关掉,用户就再也看不到进度和失败列表了。
 * - **失败逐条列**(D7):只显示「失败 3 张」等于没告诉用户该重跑哪三张。列表自身滚动,
 *   不给条数上限。
 */

export interface ExportProgressModalProps {
  visible: boolean;
  status: ExportStatus;
  total: number;
  done: number;
  failedCount: number;
  failures: readonly FrameFailure[];
  zipFileName: string | null;
  error: string | null;
  canRedownload: boolean;
  onCancelExport(): void;
  onRedownload(): void;
  onDismiss(): void;
}

/** 进度按「已回报 / 总数」算,成功与失败都要计,否则全失败的那一批永远停在 0%。 */
export const resolveProgressPercent = (
  done: number,
  failedCount: number,
  total: number
): number => {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const settled = Math.max(0, done) + Math.max(0, failedCount);
  return Math.min(100, Math.round((settled / total) * 100));
};

/** 移动端窄屏全宽(AGENTS 第 7 节),桌面固定 520px 读起来不至于拉太长。 */
const MODAL_WIDTH_DESKTOP = 520;

const MOBILE_MODAL_STYLE = { width: "calc(100vw - 24px)", maxWidth: MODAL_WIDTH_DESKTOP };
const DESKTOP_MODAL_STYLE = { width: MODAL_WIDTH_DESKTOP };

function FailureList({ failures }: { failures: readonly FrameFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <div className="export-progress-failures" data-testid="export-failures">
      <div className="export-progress-failures-title">失败明细({String(failures.length)} 张)</div>
      <ul className="export-progress-failure-list">
        {failures.map((failure, index) => (
          // 同名文件会重复出现(重名不代表同一条记录),idx + jobId 才稳定。
          <li key={`${failure.jobId}-${String(index)}`} className="export-progress-failure-item">
            <span className="export-progress-failure-name">{failure.fileName}</span>
            <span className="export-progress-failure-message">{failure.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ExportProgressModal({
  visible,
  status,
  total,
  done,
  failedCount,
  failures,
  zipFileName,
  error,
  canRedownload,
  onCancelExport,
  onRedownload,
  onDismiss
}: ExportProgressModalProps) {
  const isMobile = useIsMobile();
  const locked = status === "exporting" || status === "preparing";
  const percent = resolveProgressPercent(done, failedCount, total);
  const softLimitNotice = isMobile && total > MOBILE_SOFT_LIMIT;

  const renderBody = () => {
    if (status === "preparing") {
      return <Typography.Text type="secondary">正在准备: 读取图片尺寸与拍摄参数…</Typography.Text>;
    }
    if (status === "exporting") {
      return (
        <div className="export-progress-body">
          <Progress percent={percent} status="normal" />
          <Typography.Text className="export-progress-counter">{`已完成 ${String(
            done
          )}/${String(total)} 张, 失败 ${String(failedCount)} 张`}</Typography.Text>
          {softLimitNotice ? (
            // D19:移动端大批量只提醒、不拦人,所以这里没有按钮,只是一段说明。
            <Alert
              type="warning"
              content={`移动端一次导出 ${String(
                MOBILE_SOFT_LIMIT
              )} 张以上会较慢且占内存, 建议改用「小」档或分批导出。`}
            />
          ) : null}
          <FailureList failures={failures} />
        </div>
      );
    }
    if (status === "done") {
      return (
        <Result
          status="success"
          title="导出完成"
          subTitle={
            <div className="export-progress-result-detail">
              <div>{`成功 ${String(done)} 张, 失败 ${String(failedCount)} 张`}</div>
              <div>压缩包: {zipFileName ?? "未命名"}</div>
              <Typography.Text type="secondary">
                浏览器没有自动下载? 用下面的「重新下载」再取一次。
              </Typography.Text>
            </div>
          }
        />
      );
    }
    if (status === "failed") {
      return (
        <Result
          status="error"
          title="导出失败"
          subTitle={<div className="export-progress-result-detail">{error ?? "未知错误"}</div>}
        />
      );
    }
    return null;
  };

  const renderFooter = () => {
    if (status === "exporting") {
      return (
        <Button type="outline" status="danger" onClick={onCancelExport}>
          取消导出
        </Button>
      );
    }
    if (status === "done") {
      return (
        <Space>
          <Button type="primary" disabled={!canRedownload} onClick={onRedownload}>
            重新下载
          </Button>
          <Button onClick={onDismiss}>关闭</Button>
        </Space>
      );
    }
    if (status === "failed") {
      return (
        <Button type="primary" onClick={onDismiss}>
          关闭
        </Button>
      );
    }
    return null;
  };

  return (
    <Modal
      className="export-progress-modal"
      wrapClassName={isMobile ? "export-progress-modal-wrap--mobile" : undefined}
      title="导出进度"
      visible={visible}
      style={isMobile ? MOBILE_MODAL_STYLE : DESKTOP_MODAL_STYLE}
      maskClosable={!locked}
      escToExit={!locked}
      closable={!locked}
      footer={renderFooter()}
      onCancel={locked ? onCancelExport : onDismiss}
      unmountOnExit={true}
    >
      {renderBody()}
      {/* 失败列表在 done/failed 也要在:整批失败时它解释原因,部分成功时它说明哪几张没进包。 */}
      {status === "failed" || status === "done" ? <FailureList failures={failures} /> : null}
    </Modal>
  );
}
