import { useMemoizedFn } from "ahooks";
import isError from "lodash/isError";
import { useRef, useState } from "react";

import { useExportStore } from "../../../../store/export";
import type { ExportFileEntry } from "../../../../store/export";
import { downloadBlob } from "../../../../utils/download";
import type { CancelToken, SizeTierKey } from "../../../../utils/frame/types";
import {
  createCancelToken,
  isCancelledExport,
  runFrameExport
} from "../../../../utils/frame/export-pipeline";
import type { LogoSettings } from "./logo-settings";

/**
 * 导出主流程编排(阶段 13)。
 *
 * 时序:点导出 → 空批次拦截 → `beginExport(total)` → 开弹框 → `runFrameExport`
 * (逐张回报接 store 的 markJobDone/markJobFailed)→ 成功 `finishExport` + `downloadBlob`。
 * 分支:取消走 `isCancelledExport()` 判定后 `cancelExport()`;其它异常 `failExport(message)`。
 *
 * 三条刻意的取舍:
 * 1. **产物 Blob 不进 store**(AGENTS 第 6 节:禁止持久化 Blob 与进行中的任务状态)。
 *    「重新下载」要的字节留在 `artifactRef`,页面活着它就活着,卸载即随组件释放。
 * 2. **状态机守卫不重写**:`beginExport`/`markJobDone` 的幂等与「迟到回报丢弃」都在 store 里。
 *    本文件唯一的守卫是 `cancelTokenRef` —— 它守的不是状态而是资源:同一时刻只允许一条
 *    在途流水线,否则两次点击会抢同一批 Worker 并往两个包里写同一批图。
 * 3. **取消判定不比较 message 字符串**:文案改了判定就失效,`isCancelledExport()` 认的是错误类型。
 */

export interface UseExportFlowParams {
  files: readonly ExportFileEntry[];
  styleId: string;
  sizeTier: SizeTierKey;
  /** logo大小滑杆档位 */
  logoSize: number;
  logo: LogoSettings;
}

/** 上层异常兜底消息:流水线抛非 Error(极端情况,如 Worker 里 throw 字符串)时也要给人话。 */
const toUserMessage = (error: unknown): string => {
  const message = isError(error) ? error.message.trim() : "";
  return message || "导出失败: 未知错误, 请重试或改用更低档位。";
};

export function useExportFlow({ files, styleId, sizeTier, logoSize, logo }: UseExportFlowParams) {
  const status = useExportStore((state) => state.status);
  const [modalOpen, setModalOpen] = useState(false);
  const [noFilesHint, setNoFilesHint] = useState(false);
  const cancelTokenRef = useRef<CancelToken | null>(null);
  const artifactRef = useRef<{ zip: Blob; zipFileName: string } | null>(null);

  const exporting = status === "exporting";
  const busy = exporting || status === "preparing";
  // 取消后 store 回到 idle,弹框随之关闭;这条比「点取消时手动关」更稳,
  // 因为取消可能来自流水线内部(例如所有 Worker 都挂了导致的隐式中止)。
  const modalVisible = modalOpen && status !== "idle";
  const canRedownload = status === "done" && artifactRef.current !== null;

  const startExport = useMemoizedFn(async (): Promise<void> => {
    if (files.length === 0) {
      // 空批次连状态机都不该碰:进了 exporting 就得靠失败退出,弹框还会闪一下。
      setNoFilesHint(true);
      return;
    }
    if (cancelTokenRef.current) return;
    setNoFilesHint(false);

    const token = createCancelToken();
    cancelTokenRef.current = token;
    artifactRef.current = null;

    const state = useExportStore.getState();
    state.beginExport(files.length);
    setModalOpen(true);

    const handlers = {
      onJobDone: state.markJobDone,
      onJobFailed: state.markJobFailed
    };

    try {
      const summary = await runFrameExport(
        files.map((entry) => entry.file),
        {
          tier: sizeTier,
          styleId,
          logoMark: logo.logoMark,
          logoBlob: logo.logoBlob,
          logoSize
        },
        handlers,
        token
      );
      artifactRef.current = { zip: summary.zip, zipFileName: summary.zipFileName };
      useExportStore.getState().finishExport(summary.zipFileName);
      // downloadBlob 内部已挂 anchor + 延迟 30s revoke(D22),调用侧不得再自行 revoke。
      downloadBlob(summary.zip, summary.zipFileName);
    } catch (error) {
      if (isCancelledExport(error)) {
        useExportStore.getState().cancelExport();
        setModalOpen(false);
      } else {
        useExportStore.getState().failExport(toUserMessage(error));
      }
    } finally {
      cancelTokenRef.current = null;
    }
  });

  const requestCancel = useMemoizedFn((): void => {
    cancelTokenRef.current?.cancel();
    useExportStore.getState().cancelExport();
    setModalOpen(false);
  });

  /**
   * 关掉结果弹框。done/failed 是 store 的终态,而 store 没有「只清进度、保留文件」的动作
   * (`reset()` 会把用户挑好的图片一并清掉),故这里用 setState 将进度归零回 idle。
   */
  const dismissModal = useMemoizedFn((): void => {
    setModalOpen(false);
    useExportStore.setState({
      status: "idle",
      done: 0,
      failedCount: 0,
      total: 0,
      failures: [],
      zipFileName: null,
      error: null
    });
  });

  const redownload = useMemoizedFn((): void => {
    const artifact = artifactRef.current;
    if (artifact) downloadBlob(artifact.zip, artifact.zipFileName);
  });

  /** 重置表单:进度与产物引用一起清,产物不清就是让几百 MB 的 Blob 白占内存。 */
  const resetForm = useMemoizedFn((): void => {
    artifactRef.current = null;
    setModalOpen(false);
    setNoFilesHint(false);
    useExportStore.getState().reset();
  });

  return {
    busy,
    canRedownload,
    dismissModal,
    exporting,
    modalVisible,
    noFilesHint,
    redownload,
    requestCancel,
    resetForm,
    startExport
  };
}
