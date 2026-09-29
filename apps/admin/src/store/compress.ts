import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  DEFAULT_COMPRESS_MODE,
  DEFAULT_QUALITY,
  isCompressMode,
  isQualityPercent
} from "../utils/compress/format";
import type { CompressOutputMode, OutputMime } from "../utils/compress/format";

/**
 * 压缩图片的列表与设置状态(范式同 store/export,但生命周期不同:压缩不需要
 * 「导出中」这类全局状态机——入队即自动开压,批处理进度直接落在每张的 status 上,
 * 页面只订阅列表渲染)。
 *
 * 硬边界:
 * - **不存产物之外的任何字节决定**:result.blob 是运行时字段,与 File 同级,不进持久化;
 * - 持久化白名单只有 mode/quality 两个用户偏好(File 存不进 localStorage,
 *   进度持久化会留下「刷新后仍在压缩」的僵尸态)。
 */

/** 单张的生命周期:入队(待压)→ 压缩中 → 完成/失败。只允许沿这条单向迁移。 */
export type CompressEntryStatus = "queued" | "working" | "done" | "failed";

/** 压缩成功后的产物形状(运行时字段,不持久化)。 */
export interface CompressEntryResult {
  readonly blob: Blob;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  /** 实际编码出的 MIME,产物扩展名跟它走 */
  readonly mime: OutputMime;
  readonly fileName: string;
}

export interface CompressFileEntry {
  /** 稳定 key:时间戳 + 自增,同一毫秒批量入队也唯一(不用 crypto.randomUUID,非安全上下文缺失)。 */
  readonly id: string;
  readonly file: File;
  /** 展示用主名(去扩展名,非法字符原样保留;落盘名由批处理层 sanitize)。 */
  readonly baseName: string;
  readonly size: number;
  /** 源图尺寸,0 表示尚未探测/探测失败。 */
  readonly width: number;
  readonly height: number;
  /**
   * 列表缩略图(小图重编码,见 utils/frame/thumbnail.ts);null 表示未产出,
   * 列表退回直显原图。运行时字段,不进持久化白名单。
   */
  readonly thumb: Blob | null;
  readonly status: CompressEntryStatus;
  readonly result: CompressEntryResult | null;
  readonly errorMessage: string | null;
}

export interface CompressState {
  files: CompressFileEntry[];
  mode: CompressOutputMode;
  /** 质量百分比整数(50–95)。 */
  quality: number;
  addFiles: (files: readonly File[]) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  /** 准备阶段回写(源尺寸/缩略图)。未知 id 静默忽略。 */
  patchEntry: (
    id: string,
    patch: Partial<Pick<CompressFileEntry, "width" | "height" | "thumb">>
  ) => void;
  /** 状态迁移三动作,各自带来源状态守卫:queued→working→done|failed,违例幂等返回。 */
  markWorking: (id: string) => void;
  completeEntry: (id: string, result: CompressEntryResult) => void;
  failEntry: (id: string, message: string) => void;
  /** 批处理卸载时用:全部 working 退回 queued,让下一次挂载重新接手(不入持久化)。 */
  requeueWorking: () => void;
  setMode: (mode: CompressOutputMode) => void;
  setQuality: (quality: number) => void;
}

/** 图片受理白名单:gif 首帧可压(转 WebP),其余与导出页口径一致。 */
const IMAGE_EXTENSIONS: readonly string[] = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "heic",
  "heif"
];

let idSequence = 0;

const nextEntryId = (): string => {
  idSequence += 1;
  return `compress-${Date.now().toString(36)}-${idSequence.toString(36)}`;
};

/**
 * 判重签名:同一文件重复拖入是新的 File 引用,按内容身份(name|size|lastModified)去重,
 * 「同名不同内容」靠 size/lastModified 区分(与 store/export 同一口径)。
 */
const fileIdentity = (file: File): string => `${file.name}|${file.size}|${file.lastModified}`;

const splitFileName = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) return fileName;
  return fileName.slice(0, dotIndex);
};

/** 扩展名只取最后一个点之后(展示主名按最后一个点切,两者口径不同,不共用)。 */
const extensionOf = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) return "";
  return fileName.slice(dotIndex + 1).toLowerCase();
};

const isAcceptedImage = (file: File): boolean =>
  file.type.startsWith("image/") || IMAGE_EXTENSIONS.includes(extensionOf(file.name));

/** 表单可持久化的用户偏好:只有这两项跨会话有意义。 */
type CompressPreferences = Pick<CompressState, "mode" | "quality">;

const initialData = {
  files: [] as CompressFileEntry[],
  mode: DEFAULT_COMPRESS_MODE,
  quality: DEFAULT_QUALITY
};

// 组件内按需订阅(useCompressStore((s) => s.files)),组件外读写走 useCompressStore.getState()。
export const useCompressStore = create<CompressState>()(
  persist(
    (set) => ({
      ...initialData,

      addFiles: (files) =>
        set((state) => {
          if (files.length === 0) return state;
          const known = new Set(state.files.map((entry) => fileIdentity(entry.file)));
          const added: CompressFileEntry[] = [];
          for (const file of files) {
            if (!isAcceptedImage(file)) continue;
            const identity = fileIdentity(file);
            if (known.has(identity)) continue;
            known.add(identity);
            added.push({
              id: nextEntryId(),
              file,
              baseName: splitFileName(file.name),
              size: file.size,
              width: 0,
              height: 0,
              thumb: null,
              status: "queued",
              result: null,
              errorMessage: null
            });
          }
          if (added.length === 0) return state;
          return { files: [...state.files, ...added] };
        }),

      removeFile: (id) =>
        set((state) => {
          const next = state.files.filter((entry) => entry.id !== id);
          // 未知 id(含已被并发移除的)不产生新数组,避免多余渲染。
          return next.length === state.files.length ? state : { files: next };
        }),

      clearFiles: () => set((state) => (state.files.length === 0 ? state : { files: [] })),

      patchEntry: (id, patch) =>
        set((state) => {
          const index = state.files.findIndex((entry) => entry.id === id);
          if (index === -1) return state;
          const current = state.files[index];
          const next: CompressFileEntry = {
            ...current,
            width: patch.width ?? current.width,
            height: patch.height ?? current.height,
            thumb: patch.thumb ?? current.thumb
          };
          if (
            next.width === current.width &&
            next.height === current.height &&
            next.thumb === current.thumb
          ) {
            return state;
          }
          const files = state.files.slice();
          files[index] = next;
          return { files };
        }),

      // 状态守卫:只有 queued 能进 working。批处理重发/迟到回报会被幂等挡住,
      // 「压缩中」的条目不会因重复回报而重置进度。
      markWorking: (id) =>
        set((state) => {
          const entry = state.files.find((item) => item.id === id);
          if (!entry || entry.status !== "queued") return state;
          return {
            files: state.files.map((item) =>
              item.id === id ? { ...item, status: "working" as const } : item
            )
          };
        }),

      // 只有 working 能进 done:迟到的完成回报(条目已被移除/重排)在这里静默丢弃。
      completeEntry: (id, result) =>
        set((state) => {
          const entry = state.files.find((item) => item.id === id);
          if (!entry || entry.status !== "working") return state;
          return {
            files: state.files.map((item) =>
              item.id === id
                ? { ...item, status: "done" as const, result, errorMessage: null }
                : item
            )
          };
        }),

      // 只有 working 能进 failed;失败信息原样保留(页面按序展示),不覆盖已完成的条目。
      failEntry: (id, message) =>
        set((state) => {
          const entry = state.files.find((item) => item.id === id);
          if (!entry || entry.status !== "working") return state;
          return {
            files: state.files.map((item) =>
              item.id === id ? { ...item, status: "failed" as const, errorMessage: message } : item
            )
          };
        }),

      requeueWorking: () =>
        set((state) => {
          if (!state.files.some((item) => item.status === "working")) return state;
          return {
            files: state.files.map((item) =>
              item.status === "working" ? { ...item, status: "queued" as const } : item
            )
          };
        }),

      setMode: (mode) =>
        set((state) => (!isCompressMode(mode) || state.mode === mode ? state : { mode })),

      setQuality: (quality) =>
        set((state) =>
          !isQualityPercent(quality) || state.quality === quality ? state : { quality }
        )
    }),
    {
      name: "image-compress.settings",
      // 白名单持久化:files 含 File 与 Blob 存不进 localStorage;status 持久化会留下
      // 「刷新后仍在压缩」的僵尸态(批处理不会再跑,进度永远不动),所以一条都不落盘。
      partialize: (state): CompressPreferences => ({
        mode: state.mode,
        quality: state.quality
      }),
      // 读取只信白名单:手工改过的 storage 与旧版本残留不允许复活 files 或越界偏好。
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<CompressPreferences>;
        return {
          ...current,
          mode: isCompressMode(saved.mode) ? saved.mode : current.mode,
          quality: isQualityPercent(saved.quality) ? saved.quality : current.quality
        };
      }
    }
  )
);
