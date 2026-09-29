import { Message } from "@arco-design/web-react";
import { useMemoizedFn } from "ahooks";
import { useState } from "react";

import { COMPRESS_ZIP_PREFIX } from "../../constants";
import { useCompressStore } from "../../store/compress";
import type { CompressEntryResult, CompressFileEntry } from "../../store/compress";
import { downloadBlob } from "../../utils/download";
import { buildZipFileName } from "../../utils/file-name";
import { createZipWriter, PACK_FAILURE_PREFIX } from "../../utils/frame/zip-writer";

/**
 * 压缩产物的下载动作:单张下载与整批打包 zip,复用 frame 的流式 zip 写入器与
 * utils/download 的 anchor 收口(产物字节只经内存过一次手,不驻留 store)。
 */

type DoneEntry = { id: string; result: CompressEntryResult };

const isDoneEntry = (entry: CompressFileEntry): entry is CompressFileEntry & DoneEntry =>
  entry.status === "done" && entry.result !== null;

/** 整批 zip 的内容物:全部已完成条目(按列表顺序)。 */
export const doneResultsOf = (files: readonly CompressFileEntry[]): DoneEntry[] =>
  files.filter(isDoneEntry).map(({ id, result }) => ({ id, result }));

export function useCompressDownload() {
  const [packing, setPacking] = useState(false);

  const downloadOne = useMemoizedFn((result: CompressEntryResult): void => {
    downloadBlob(result.blob, result.fileName);
  });

  const downloadZip = useMemoizedFn(async (): Promise<void> => {
    if (packing) return;
    const done = doneResultsOf(useCompressStore.getState().files);
    if (done.length === 0) return;
    setPacking(true);
    const writer = createZipWriter();
    try {
      for (const { result } of done) {
        await writer.add(result.fileName, result.blob);
      }
      const zip = await writer.finish();
      downloadBlob(zip, buildZipFileName(new Date(), COMPRESS_ZIP_PREFIX));
    } catch (cause) {
      // 打包失败必须让用户看到:静默返回会变成「点了没反应」。
      // writer 在异常路径上丢弃已累积分片,与导出流水线同一纪律。
      writer.discard();
      const reason = cause instanceof Error ? cause.message : String(cause);
      Message.error(`${PACK_FAILURE_PREFIX}: ${reason}`);
    } finally {
      setPacking(false);
    }
  });

  return { packing, downloadOne, downloadZip };
}
