import { useMemoizedFn } from "ahooks";
import { useEffect, useRef } from "react";

import { useExportStore } from "../../../../store/export";
import type { ExportFileEntry } from "../../../../store/export";
import { extractPhotoExif } from "../../../../utils/frame/fields";
import { probeSourceSize } from "../../../../utils/frame/export-pipeline";
import { makePhotoThumbnail } from "../../../../utils/frame/thumbnail";
import type { OutputSize, PhotoExif } from "../../../../utils/frame/types";

/**
 * 文件准备阶段(阶段 13):新入队的图片异步探源图尺寸 + 读 EXIF + 产列表缩略图,
 * 结果经 `patchFile` 回写。
 *
 * 为什么这三件事放在页面而不是流水线里:流水线自己也会探尺寸(派发前必须算目标尺寸),
 * 页面要的是**另一份**用途相同的结果 —— 表单要在用户点导出之前就显示「这张 6000×4000
 * 会被压到多小」,实时预览更是要在挑选阶段就拿到 EXIF 文案,列表缩略图则让「照片」卡片
 * 不必解码整幅原图(直显原图是上传后页面卡顿的主因,见 utils/frame/thumbnail)。
 * 两边读的是同一个 `probeSourceSize`,不存在第二套解析口径。
 *
 * 为什么限并发:三件读取全在主线程语境跑(exifr 解析、缩略图的解码与重编码),
 * 一次多选几十张时同时开跑会让主线程连续喂饱任务、页面点不动;
 * `PREPARATION_CONCURRENCY` 排队逐对推进,把开销摊平。
 *
 * `status: "preparing"` 由本文件用 `setState` 直接推进,store 侧刻意不加动作:
 * 「手里有一批在途读取」是页面编排出来的过程,不是用户动作也不是数据状态;
 * 做成 store 动作会让 store 反过来定义一个只有页面才有的生命周期。
 * 进出都带守卫:只在 idle 进入、只在仍是 preparing 时退出。
 *
 * 卸载安全:探测是异步的,而中途用户可能整页跳走。`mountedRef` 为假时探测结果整条丢弃,
 * 既不写 entry 也不动状态机。
 */

/** 在途准备任务的并发上限(见文件头「为什么限并发」)。 */
const PREPARATION_CONCURRENCY = 2;

/**
 * 一张图的准备结果:三路读取各自独立成败,尺寸与 EXIF 并行、缩略图依赖尺寸结果,
 * 所以只有前两路用 allSettled。
 */
interface EntryProbe {
  size: OutputSize | null;
  exif: PhotoExif | null;
  thumb: Blob | null;
}

/**
 * 探测一张。`extractPhotoExif` 契约上永不抛错,但 `probeSourceSize` 会(二次解码兜底也可能失败),
 * 分开收敛才有意义:尺寸读不到只是「未知」(0 是合法终态),EXIF 读不到才该留 exifReadAt 为 null。
 * 全抛给上层会变成一张坏图吞掉另一张的好结果。缩略图自己把失败收敛成 null,不再往外抛。
 */
async function probeEntry(entry: ExportFileEntry): Promise<EntryProbe> {
  const [sizeResult, exifResult] = await Promise.allSettled([
    probeSourceSize(entry.file),
    extractPhotoExif(entry.file)
  ]);
  const size = sizeResult.status === "fulfilled" ? sizeResult.value : null;
  const exif = exifResult.status === "fulfilled" ? exifResult.value : null;
  // 缩略图要按等比目标解码,只能等尺寸落定;尺寸未知时它返回 null,列表退回直显原图。
  const thumb = await makePhotoThumbnail(entry.file, size);
  return { size, exif, thumb };
}

export function useFilePreparation(files: readonly ExportFileEntry[]): void {
  /** 已受理过的 entry id(在途与已完成都算):同一 entry 只探一次,探失败的也不重探。 */
  const acceptedRef = useRef<Set<string>>(new Set());
  /** 排队中的待探测条目;出队时机由 pump 按并发上限决定。 */
  const pendingRef = useRef<ExportFileEntry[]>([]);
  /** 在途探测数,归零即准备完成。 */
  const outstandingRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const finishIfSettled = useMemoizedFn((): void => {
    if (outstandingRef.current > 0 || !mountedRef.current) return;
    // 只从 preparing 退出:探测期间用户可能已经点了导出(状态已进 exporting),
    // 那时把状态改回 idle 等于把正在走的进度条抹掉,属于非法回退。
    useExportStore.setState((state) => (state.status === "preparing" ? { status: "idle" } : {}));
  });

  const prepareOne = useMemoizedFn(async (entry: ExportFileEntry): Promise<void> => {
    try {
      const probe = await probeEntry(entry);
      if (!mountedRef.current) return;
      if (probe.exif) {
        // 带 exif 的 patch 会写 exifReadAt:这就是「读过但可能读空」的凭据。
        useExportStore.getState().patchFile(entry.id, {
          exif: probe.exif,
          width: probe.size?.width ?? 0,
          height: probe.size?.height ?? 0,
          thumb: probe.thumb ?? undefined
        });
      } else if (probe.size) {
        // 尺寸读到了但 EXIF 整条失败:只回写尺寸与缩略图,exifReadAt 留 null 表示「没读到过」。
        useExportStore.getState().patchFile(entry.id, {
          width: probe.size.width,
          height: probe.size.height,
          thumb: probe.thumb ?? undefined
        });
      }
    } finally {
      // 计数只在这一处减:`probeEntry` 已经用 allSettled 消化了两个读取的失败,
      // 真抛出来就是 store 层的问题,让它冒到上层,但欠的账要先还,否则 preparing 永远出不去。
      outstandingRef.current -= 1;
      pump();
    }
  });

  /** 按并发上限从队列放行任务;队列放空且在途归零时收拢 preparing 状态。 */
  const pump = useMemoizedFn((): void => {
    while (
      outstandingRef.current < PREPARATION_CONCURRENCY &&
      pendingRef.current.length > 0 &&
      mountedRef.current
    ) {
      const entry = pendingRef.current.shift();
      if (!entry) break;
      outstandingRef.current += 1;
      // 账已在 prepareOne 的 finally 里还过,这里的 catch 只是不让一个没人认领的 rejection 冒到全局。
      void prepareOne(entry).catch(() => undefined);
    }
    finishIfSettled();
  });

  useEffect(() => {
    const fresh = files.filter((entry) => !acceptedRef.current.has(entry.id));
    if (fresh.length === 0) return;

    for (const entry of fresh) {
      acceptedRef.current.add(entry.id);
    }
    if (mountedRef.current) {
      // 只从 idle 进入:done/failed 时结果弹框还开着,插一个 preparing 会让它闪回进度视图。
      useExportStore.setState((state) => (state.status === "idle" ? { status: "preparing" } : {}));
    }
    pendingRef.current.push(...fresh);
    pump();
  }, [files, pump, finishIfSettled]);
}
