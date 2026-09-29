import { useMemoizedFn } from "ahooks";
import { useEffect, useRef } from "react";

import { useCompressStore } from "../../store/compress";
import type { CompressEntryResult } from "../../store/compress";
import { createCompressCancelToken, runCompressBatch } from "../../utils/compress/compress-batch";
import type { CompressCancelToken, CompressItemResult } from "../../utils/compress/compress-batch";

/**
 * 压缩批处理的自动编排:发现「排队中」的条目就整批派发,结果逐条写回 store。
 *
 * 为什么做成 hook 而不是 store 动作:与导出页同一条边界——「手里有一批在途任务」是页面
 * 编排出来的过程,store 只记录每张的状态,不定义批处理生命周期(见 use-file-preparation)。
 *
 * 重入与取消:
 * - runningRef 保证任何时刻至多一批在跑;批内新 patch 引发的 effect 重入都被它挡住;
 * - 一批正常收尾后 finally 里主动复查一次 store,把「取消残留的排队条目」或 StrictMode
 *   双挂载期间的漏网任务重新拉起,不依赖下一次 store 变更;
 * - 卸载(含 StrictMode 卸载重挂)先把 working 条目退回 queued 再取消令牌:老一批的
 *   迟到产物因令牌作废被丢弃,新挂载会从头接手,不会留下永远「压缩中」的僵尸条目。
 */
export interface CompressRunControl {
  /** 清空列表等场景主动放弃当前批:在途任务自然结束,产物被丢弃。 */
  cancelActiveBatch: () => void;
}

const toEntryResult = (result: CompressItemResult): CompressEntryResult => ({
  blob: result.blob,
  size: result.size,
  width: result.width,
  height: result.height,
  // Worker 回报的实际 MIME 超出三种目标档时按 JPEG 记(扩展名跟 fileName 走,不受影响)。
  mime: result.mime === "image/png" || result.mime === "image/webp" ? result.mime : "image/jpeg",
  fileName: result.fileName
});

export function useCompressRun(): CompressRunControl {
  const runningRef = useRef(false);
  const tokenRef = useRef<CompressCancelToken | null>(null);
  // 启动时机订阅列表本身:入队、清空、重排都会触发复查;runningRef 挡住在途重入。
  const files = useCompressStore((state) => state.files);

  const maybeStart = useMemoizedFn((): void => {
    if (runningRef.current) return;
    const { files: currentFiles, mode, quality } = useCompressStore.getState();
    const queued = currentFiles.filter((entry) => entry.status === "queued");
    if (queued.length === 0) return;

    runningRef.current = true;
    const token = createCompressCancelToken();
    tokenRef.current = token;
    void runCompressBatch(
      queued.map((entry) => ({
        id: entry.id,
        file: entry.file,
        width: entry.width,
        height: entry.height
      })),
      { mode, qualityPercent: quality },
      {
        onItemStarted: (id) => useCompressStore.getState().markWorking(id),
        onItemDone: (result) =>
          useCompressStore.getState().completeEntry(result.id, toEntryResult(result)),
        onItemFailed: (failure) =>
          useCompressStore.getState().failEntry(failure.id, failure.message)
      },
      token
    ).then(
      (tally) => {
        runningRef.current = false;
        tokenRef.current = null;
        // 取消过的批次不在收尾时自动重启:重启语义只属于「新的入队」,
        // 否则用户刚取消就立刻复活整批(取消的真实出口是清空列表,见 page)。
        if (!tally.cancelled) maybeStart();
      },
      () => {
        // runCompressBatch 契约上不 reject(单张失败已在批内收敛);兜底只为归还运行权,
        // 绝不在此重试——持久性失败重试会变成死循环。
        runningRef.current = false;
        tokenRef.current = null;
      }
    );
  });

  useEffect(() => {
    maybeStart();
  }, [files, maybeStart]);

  useEffect(
    () => () => {
      // 先退态再取消:working→queued 让重挂载后能重新入队;令牌作废保证老批不再写 store。
      // 只在卸载时清理(deps 为空),不随 files 变化重挂,否则会掐断正在跑的批。
      const { files: currentFiles, requeueWorking } = useCompressStore.getState();
      if (currentFiles.some((entry) => entry.status === "working")) {
        requeueWorking();
      }
      tokenRef.current?.cancel();
      tokenRef.current = null;
      runningRef.current = false;
    },
    []
  );

  return {
    cancelActiveBatch: useMemoizedFn(() => {
      tokenRef.current?.cancel();
    })
  };
}
