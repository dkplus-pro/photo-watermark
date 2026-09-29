import { useMemoizedFn } from "ahooks";
import sumBy from "lodash/sumBy";
import { useMemo } from "react";

import PageContainer from "../../components/page-container";
import { useCompressStore } from "../../store/compress";
import type { CompressFileEntry } from "../../store/compress";
import DropZone from "./components/drop-zone";
import ResultList from "./components/result-list";
import SettingsCard from "./components/settings-card";
import SummaryBar from "./components/summary-bar";
import { useCompressDownload } from "./use-compress-download";
import { useCompressPreparation } from "./use-compress-preparation";
import { useCompressRun } from "./use-compress-run";

import "./index.css";

/**
 * 压缩图片页(入口见 config/menu 的「压缩图片」)。
 *
 * 本页是「拖入即压」的工具流:DropZone 收文件 → store 入队(queued)→ 准备 hook 探尺寸
 * 与缩略图 → 运行 hook 自动整批派发(Worker 池)→ 结果逐条写回 store → 列表展示,
 * 单张可单独下载,整批经 zip-writer 打包一次下载。页面只做数据编排与布局,
 * 不写压缩语义(那在 utils/compress)也不写渲染逻辑。
 */
export default function CompressPage() {
  const files = useCompressStore((state) => state.files);
  const mode = useCompressStore((state) => state.mode);
  const quality = useCompressStore((state) => state.quality);

  useCompressPreparation(files);
  const { cancelActiveBatch } = useCompressRun();
  const { packing, downloadOne, downloadZip } = useCompressDownload();

  // store 动作经 getState 取用(action 引用恒稳定),不订阅多余切片。
  const handleAdd = useMemoizedFn((incoming: readonly File[]) => {
    useCompressStore.getState().addFiles(incoming);
  });
  const handleRemove = useMemoizedFn((id: string) => {
    useCompressStore.getState().removeFile(id);
  });
  const handleClear = useMemoizedFn(() => {
    // 先放弃在途批再清列表:迟到产物因令牌作废被丢弃,不会写进已清空的列表。
    cancelActiveBatch();
    useCompressStore.getState().clearFiles();
  });
  const handleModeChange = useMemoizedFn((next: typeof mode) => {
    useCompressStore.getState().setMode(next);
  });
  const handleQualityChange = useMemoizedFn((next: number) => {
    useCompressStore.getState().setQuality(next);
  });

  const { doneEntries, doneOriginalBytes, doneCompressedBytes, failedCount } = useMemo(() => {
    const done = files.filter((entry) => entry.status === "done" && entry.result !== null);
    return {
      doneEntries: done,
      doneOriginalBytes: sumBy(done, "size"),
      doneCompressedBytes: sumBy(done, (entry: CompressFileEntry) => entry.result?.size ?? 0),
      failedCount: files.filter((entry) => entry.status === "failed").length
    };
  }, [files]);

  return (
    <PageContainer>
      <div className="compress-body">
        <DropZone compact={files.length > 0} onAdd={handleAdd} />
        {files.length > 0 ? (
          <SettingsCard
            mode={mode}
            quality={quality}
            onModeChange={handleModeChange}
            onQualityChange={handleQualityChange}
          />
        ) : null}
        {files.length > 0 ? (
          <ResultList entries={files} onDownload={downloadOne} onRemove={handleRemove} />
        ) : null}
      </div>
      {files.length > 0 ? (
        <SummaryBar
          doneCount={doneEntries.length}
          totalCount={files.length}
          failedCount={failedCount}
          originalBytes={doneOriginalBytes}
          compressedBytes={doneCompressedBytes}
          packing={packing}
          onDownloadZip={() => void downloadZip()}
          onClear={handleClear}
        />
      ) : null}
    </PageContainer>
  );
}
