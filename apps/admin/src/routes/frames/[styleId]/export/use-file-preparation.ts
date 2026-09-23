import { useMemoizedFn } from "ahooks";
import { useEffect, useRef } from "react";

import { useExportStore } from "../../../../store/export";
import type { ExportFileEntry } from "../../../../store/export";
import { extractPhotoExif } from "../../../../utils/frame/fields";
import { probeSourceSize } from "../../../../utils/frame/export-pipeline";
import type { OutputSize, PhotoExif } from "../../../../utils/frame/types";

/**
 * 文件准备阶段(阶段 13):新入队的图片异步探源图尺寸 + 读 EXIF,结果经 `patchFile` 回写。
 *
 * 为什么这两件事放在页面而不是流水线里:流水线自己也会探尺寸(派发前必须算目标尺寸),
 * 页面要的是**另一份**用途相同的结果 —— 表单要在用户点导出之前就显示「这张 6000×4000
 * 会被压到多小」,实时预览更是要在挑选阶段就拿到 EXIF 文案。两边读的是同一个
 * `probeSourceSize`,不存在第二套解析口径。
 *
 * `status: "preparing"` 由本文件用 `setState` 直接推进,store 侧刻意不加动作:
 * 「手里有一批在途读取」是页面编排出来的过程,不是用户动作也不是数据状态;
 * 做成 store 动作会让 store 反过来定义一个只有页面才有的生命周期。
 * 进出都带守卫:只在 idle 进入、只在仍是 preparing 时退出。
 *
 * 卸载安全:探测是异步的,而中途用户可能整页跳走。`mountedRef` 为假时探测结果整条丢弃,
 * 既不写 entry 也不动状态机。
 */

/** 一张图的准备结果:两个读取各自独立成败,所以用 allSettled 而不是 all。 */
interface EntryProbe {
  size: OutputSize | null;
  exif: PhotoExif | null;
}

/**
 * 探测一张。`extractPhotoExif` 契约上永不抛错,但 `probeSourceSize` 会(二次解码兜底也可能失败),
 * 分开收敛才有意义:尺寸读不到只是「未知」(0 是合法终态),EXIF 读不到才该留 exifReadAt 为 null。
 * 全抛给上层会变成一张坏图吞掉另一张的好结果。
 */
async function probeEntry(entry: ExportFileEntry): Promise<EntryProbe> {
  const [sizeResult, exifResult] = await Promise.allSettled([
    probeSourceSize(entry.file),
    extractPhotoExif(entry.file)
  ]);
  return {
    size: sizeResult.status === "fulfilled" ? sizeResult.value : null,
    exif: exifResult.status === "fulfilled" ? exifResult.value : null
  };
}

export function useFilePreparation(files: readonly ExportFileEntry[]): void {
  /** 已受理过的 entry id(在途与已完成都算):同一 entry 只探一次,探失败的也不重探。 */
  const acceptedRef = useRef<Set<string>>(new Set());
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
          height: probe.size?.height ?? 0
        });
      } else if (probe.size) {
        // 尺寸读到了但 EXIF 整条失败:只回写尺寸,exifReadAt 留 null 表示「没读到过」。
        useExportStore.getState().patchFile(entry.id, probe.size);
      }
    } finally {
      // 计数只在这一处减:`probeEntry` 已经用 allSettled 消化了两个读取的失败,
      // 真抛出来就是 store 层的问题,让它冒到上层,但欠的账要先还,否则 preparing 永远出不去。
      outstandingRef.current -= 1;
      finishIfSettled();
    }
  });

  useEffect(() => {
    const fresh = files.filter((entry) => !acceptedRef.current.has(entry.id));
    if (fresh.length === 0) return;

    for (const entry of fresh) {
      acceptedRef.current.add(entry.id);
      outstandingRef.current += 1;
    }
    if (mountedRef.current) {
      // 只从 idle 进入:done/failed 时结果弹框还开着,插一个 preparing 会让它闪回进度视图。
      useExportStore.setState((state) => (state.status === "idle" ? { status: "preparing" } : {}));
    }

    for (const entry of fresh) {
      // 账已在 prepareOne 的 finally 里还过,这里的 catch 只是不让一个没人认领的 rejection 冒到全局。
      void prepareOne(entry).catch(() => undefined);
    }
  }, [files, prepareOne, finishIfSettled]);
}
