import { useMemoizedFn } from "ahooks";
import { useEffect, useRef } from "react";

import { useCompressStore } from "../../store/compress";
import type { CompressFileEntry } from "../../store/compress";
import { probeSourceSize } from "../../utils/frame/image-size-probe";
import { makePhotoThumbnail } from "../../utils/frame/thumbnail";

/**
 * 入队图片的准备阶段:异步探源图尺寸 + 产列表缩略图,结果经 patchEntry 回写。
 * 范式与导出页 use-file-preparation 一致(那边还要读 EXIF,压缩不需要)——
 * 两边读同一个 probeSourceSize,不存在第二套解析口径;缩略图让列表不必解码整幅原图
 * (直显原图是「多选几张就卡顿」的主因,见 utils/frame/thumbnail)。
 *
 * 并发 2:三件读取全在主线程语境跑,一次几十张同时开跑会把交互顶住。
 * 卸载安全:mountedRef 为假时探测结果整条丢弃。
 */

const PREPARATION_CONCURRENCY = 2;

export function useCompressPreparation(files: readonly CompressFileEntry[]): void {
  /** 已受理过的 entry id(在途与已完成都算):同一 entry 只探一次,探失败的也不重探。 */
  const acceptedRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<CompressFileEntry[]>([]);
  const outstandingRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const prepareOne = useMemoizedFn(async (entry: CompressFileEntry): Promise<void> => {
    try {
      const size = await probeSourceSize(entry.file);
      // 缩略图要按等比目标解码,只能等尺寸落定;尺寸未知时它返回 null,列表退回直显原图。
      const thumb = await makePhotoThumbnail(entry.file, size);
      if (!mountedRef.current) return;
      useCompressStore.getState().patchEntry(entry.id, {
        width: size?.width ?? 0,
        height: size?.height ?? 0,
        thumb: thumb ?? undefined
      });
    } finally {
      // 账只在这一处还:probeSourceSize 抛错(二次解码兜底失败)也算探过,不重探。
      outstandingRef.current -= 1;
      pump();
    }
  });

  const pump = useMemoizedFn((): void => {
    while (
      outstandingRef.current < PREPARATION_CONCURRENCY &&
      pendingRef.current.length > 0 &&
      mountedRef.current
    ) {
      const entry = pendingRef.current.shift();
      if (!entry) break;
      outstandingRef.current += 1;
      void prepareOne(entry).catch(() => undefined);
    }
  });

  useEffect(() => {
    const fresh = files.filter((entry) => !acceptedRef.current.has(entry.id));
    if (fresh.length === 0) return;
    for (const entry of fresh) {
      acceptedRef.current.add(entry.id);
    }
    pendingRef.current.push(...fresh);
    pump();
  }, [files, pump]);
}
