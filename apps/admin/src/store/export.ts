import { create } from "zustand";
import { persist } from "zustand/middleware";

import { PLAIN_FRAME_STYLE_ID } from "../utils/frame/style-registry";
import {
  DEFAULT_LOGO_SIZE,
  DEFAULT_SIZE_TIER,
  LOGO_SIZE_MAX,
  LOGO_SIZE_MIN,
  SIZE_TIER_KEYS
} from "../utils/frame/types";
import type { FrameFailure, FrameTaskResult, PhotoExif, SizeTierKey } from "../utils/frame/types";

/**
 * 导出表单状态:「本地图片 → 相框渲染 → zip 下载」链路上唯一的 UI 状态载体。
 * 页面收集用户选择(文件/样式/档位/logo)并编排流水线,流水线的进度回报经 beginExport /
 * markJobDone / markJobFailed / finishExport 落回这里。store 不 import `utils/frame/export-pipeline`
 * (编排方向在页面,见 AGENTS.md 第 1 节),也绝不存产物字节:一次驻留 50 张成品 Blob 就是内存事故。
 */

/** logo 选择的两个哨兵值,都不在 `public/logos.json` 清单里(自定义项由 UI 固定追加)。 */
export const CUSTOM_LOGO_ID = "custom";
export const NO_LOGO_ID = "none";

/** D19:移动端批量超过这个张数时,页面给一条内存/耗时软提示(不阻断)。store 只提供计数事实。 */
export const MOBILE_SOFT_LIMIT = 20;

/**
 * 图片扩展名白名单。`File.type` 在部分系统(尤其 heic)与拖拽场景下是空串,只能再按扩展名兜底。
 * 类型不合法的在选择期就拒收(收进来只会在渲染期失败);但「扩展名合法、内容不是图」仍然收,
 * 解码失败按 D7 走单张失败列表,这里不做 magic number 校验。
 */
const IMAGE_EXTENSIONS: readonly string[] = ["jpg", "jpeg", "png", "webp", "avif", "heic", "heif"];

/** uid 自增段:同一毫秒内批量选择也要保证 id 唯一。不用 crypto.randomUUID(非安全上下文/旧 Safari 缺失)。 */
let idSequence = 0;

const nextEntryId = (): string => {
  idSequence += 1;
  return `photo-${Date.now().toString(36)}-${idSequence.toString(36)}`;
};

/**
 * 判重签名:本地文件重选后是新的 File 引用,光比引用会重复收同一张图。
 * 内容不同的文件必然在 size 或 lastModified 上分开,故签名足够区分「同名不同内容」。
 */
const fileIdentity = (file: File): string => `${file.name}|${file.size}|${file.lastModified}`;

/**
 * 主名与扩展名一次算出:主名只剥最后一段扩展,且仅用于展示(产物主名由渲染侧 sanitizeBaseName 决定)。
 * 点号在首位的命名(如 ".jpg")按整名处理,避免空主名。
 */
const splitFileName = (fileName: string): { baseName: string; extension: string } => {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) return { baseName: fileName, extension: "" };
  return {
    baseName: fileName.slice(0, dotIndex),
    extension: fileName.slice(dotIndex + 1).toLowerCase()
  };
};

/** 受理判定:type 与扩展名任一命中即放行,取舍理由见上方白名单注释。 */
const isAcceptedImage = (file: File): boolean =>
  file.type.startsWith("image/") || IMAGE_EXTENSIONS.includes(splitFileName(file.name).extension);

export interface ExportFileEntry {
  /** 稳定 key:同一文件重复选择要能区分,故用时间戳 + 自增生成的短 uid。 */
  readonly id: string;
  readonly file: File;
  /** 展示用主名(去扩展名)。 */
  readonly baseName: string;
  readonly size: number;
  /** 读取结果;null 且 exifReadAt 为 null 表示尚未读,null 且 exifReadAt 有值表示读过但失败。 */
  readonly exif: PhotoExif | null;
  /** EXIF 读取尝试完成时刻(成功与失败都写),用于把「未读」与「读失败」区分开。 */
  readonly exifReadAt: number | null;
  /** 源图尺寸,0 表示尚未探测。 */
  readonly width: number;
  readonly height: number;
  /**
   * 列表缩略图(小尺寸重编码,见 utils/frame/thumbnail.ts);null 表示未产出,
   * 列表退回直显原图。运行时字段:与 File 同级,不进持久化白名单。
   */
  readonly thumb: Blob | null;
}

export type ExportStatus = "idle" | "preparing" | "exporting" | "done" | "failed";

export interface ExportState {
  files: ExportFileEntry[];
  styleId: string;
  sizeTier: SizeTierKey;
  /** 预设 id 来自 logos.json;"custom" 走 customLogoFile;"none" 表示不加 logo。 */
  logoId: string;
  /** logo大小滑杆档位(5–10 整数,10 = 基准几何)。 */
  logoSize: number;
  customLogoFile: File | null;
  status: ExportStatus;
  done: number;
  failedCount: number;
  total: number;
  failures: FrameFailure[];
  zipFileName: string | null;
  error: string | null;
  /** 批量添加:同文件去重、非图片拒收;张数无硬上限(D19 的 >20 软提示由页面按 files.length 做)。 */
  addFiles: (files: readonly File[]) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  /** 流水线探测回写(EXIF / 源图尺寸 / 列表缩略图)。携带 exif 即视为「读过」。未知 id 静默忽略。 */
  patchFile: (
    id: string,
    patch: Partial<Pick<ExportFileEntry, "exif" | "width" | "height" | "thumb">>
  ) => void;
  setStyleId: (id: string) => void;
  setSizeTier: (tier: SizeTierKey) => void;
  setLogoId: (id: string) => void;
  setLogoSize: (size: number) => void;
  setCustomLogo: (file: File | null) => void;
  beginExport: (total: number) => void;
  markJobDone: (result: FrameTaskResult) => void;
  markJobFailed: (failure: FrameFailure) => void;
  finishExport: (zipFileName: string) => void;
  failExport: (message: string) => void;
  cancelExport: () => void;
  reset: () => void;
}

/** 表单可持久化的用户偏好:只这三项跨会话有意义。 */
type ExportPreferences = Pick<ExportState, "sizeTier" | "logoId" | "logoSize">;

const initialData = {
  files: [] as ExportFileEntry[],
  styleId: PLAIN_FRAME_STYLE_ID,
  sizeTier: DEFAULT_SIZE_TIER,
  logoId: NO_LOGO_ID,
  logoSize: DEFAULT_LOGO_SIZE,
  customLogoFile: null as File | null,
  status: "idle" as ExportStatus,
  done: 0,
  failedCount: 0,
  total: 0,
  failures: [] as FrameFailure[],
  zipFileName: null as string | null,
  error: null as string | null
};

const isSizeTierKey = (value: unknown): value is SizeTierKey =>
  typeof value === "string" && (SIZE_TIER_KEYS as readonly string[]).includes(value);

/** 持久化回读要挡的是手改 localStorage 的越界值:档位只认 5–10 的整数。 */
const isLogoSize = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= LOGO_SIZE_MIN &&
  (value as number) <= LOGO_SIZE_MAX;

// 组件内按需订阅(useExportStore((s) => s.files)),组件外读写走 useExportStore.getState()。
export const useExportStore = create<ExportState>()(
  persist(
    (set) => ({
      ...initialData,

      addFiles: (files) =>
        set((state) => {
          if (files.length === 0) return state;
          const known = new Set(state.files.map((entry) => fileIdentity(entry.file)));
          const added: ExportFileEntry[] = [];
          for (const file of files) {
            if (!isAcceptedImage(file)) continue;
            const identity = fileIdentity(file);
            if (known.has(identity)) continue;
            known.add(identity);
            added.push({
              id: nextEntryId(),
              file,
              baseName: splitFileName(file.name).baseName,
              size: file.size,
              exif: null,
              exifReadAt: null,
              width: 0,
              height: 0,
              thumb: null
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

      patchFile: (id, patch) =>
        set((state) => {
          const index = state.files.findIndex((entry) => entry.id === id);
          if (index === -1) return state;
          const current = state.files[index];
          const exifChanged = patch.exif !== undefined;
          const next: ExportFileEntry = {
            ...current,
            exif: exifChanged ? patch.exif : current.exif,
            exifReadAt: exifChanged ? Date.now() : current.exifReadAt,
            width: patch.width ?? current.width,
            height: patch.height ?? current.height,
            thumb: patch.thumb ?? current.thumb
          };
          if (
            next.exif === current.exif &&
            next.exifReadAt === current.exifReadAt &&
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

      setStyleId: (styleId) => set((state) => (state.styleId === styleId ? state : { styleId })),

      setSizeTier: (tier) => set((state) => (state.sizeTier === tier ? state : { sizeTier: tier })),

      // 边界归属:setLogoId("custom") 时 customLogoFile 是否为空由页面拦截;
      // setCustomLogo(null) 也不自动把 logoId 从 "custom" 退回清单首项。
      // 理由是单一职责 —— 清单(阶段 6)与表单校验都在页面层,store 不猜用户下一步。
      setLogoId: (logoId) => set((state) => (state.logoId === logoId ? state : { logoId })),

      // 滑杆只会产出 5–10 的整数,但 store 是唯一写入口,越界值(手改/脏调用)直接拒收。
      setLogoSize: (logoSize) =>
        set((state) =>
          !isLogoSize(logoSize) || state.logoSize === logoSize ? state : { logoSize }
        ),

      setCustomLogo: (file) =>
        set((state) => (state.customLogoFile === file ? state : { customLogoFile: file })),

      // 状态机守卫:只有 idle/preparing 能进入 exporting。
      // 防的是用户双击导出按钮起两条流水线 —— 两条链会抢同一批 Worker,并往同一个 zip 里写。
      // 因此非法迁移(exporting 重入、done/failed 不经 reset 直接重开)一律幂等返回,不打日志。
      beginExport: (total) =>
        set((state) => {
          if (state.status !== "idle" && state.status !== "preparing") return state;
          return {
            status: "exporting",
            // 零值合法(total=0 表示空批次,流水线会立刻 finish);负数/小数按不计数处理。
            total: Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0,
            done: 0,
            failedCount: 0,
            failures: [],
            zipFileName: null,
            error: null
          };
        }),

      // 只在 exporting 计数:取消或结束后迟到的回报必须丢弃,否则进度条会「复活」。
      // 越界收敛是硬要求 —— Worker 乱序/重复回报会让 done + failedCount 冲过 total。
      markJobDone: (result) =>
        set((state) => {
          if (state.status !== "exporting") return state;
          // 缺 jobId 的回报不符合 FrameTaskResult 形状,视为脏消息丢弃(不计入进度也不记失败)。
          if (!result.jobId) return state;
          if (state.done + state.failedCount >= state.total) return state;
          return { done: state.done + 1 };
        }),

      markJobFailed: (failure) =>
        set((state) => {
          if (state.status !== "exporting") return state;
          if (!failure.jobId) return state;
          if (state.done + state.failedCount >= state.total) return state;
          // failures 累积并保留回报顺序,页面按序展示「哪几张坏了」。
          return { failedCount: state.failedCount + 1, failures: [...state.failures, failure] };
        }),

      finishExport: (zipFileName) =>
        set((state) => {
          if (state.status !== "exporting") return state;
          // done === 0 意味着全失败,但「算成功还是算失败」由页面判断后再调 failExport,store 不猜。
          return { status: "done", zipFileName };
        }),

      // 上游(流水线/解码/打包)整体失败的兜底消息。done/failed 是终态,不被迟到失败覆盖。
      failExport: (message) =>
        set((state) => {
          if (state.status === "done" || state.status === "failed") return state;
          return { status: "failed", error: message };
        }),

      // 取消:回到 idle,但保留 done/failedCount/total/failures —— 用户要看到「已完成 12/50 时取消」
      // 以及已经失败的是哪几张;丢掉这些等于抹掉刚才那批工作的结果。zipFileName 清空(未产出的包不可下载)。
      cancelExport: () =>
        set((state) => {
          if (state.status !== "exporting" && state.status !== "preparing") return state;
          return { status: "idle", zipFileName: null, error: null };
        }),

      // 重开表单:清文件与进度,但保留 sizeTier/logoId/logoSize(用户偏好,不该再选一遍)。
      // customLogoFile 必须清(File 不持久化);故 reload 后 logoId 可能仍是 "custom" 而无文件,
      // 这属于页面必须拦的非法组合(与 setCustomLogo(null) 的边界归属同一条)。
      reset: () =>
        set((state) => {
          const { sizeTier, logoId, logoSize } = state;
          return { ...initialData, sizeTier, logoId, logoSize };
        })
    }),
    {
      name: "watermark-frame.export",
      // 白名单持久化:File 存不进 localStorage;status/进度持久化会留下「刷新后还在 exporting」
      // 的僵尸态(进度条永远不动、导出按钮被守卫锁死),所以一条都不落盘。
      partialize: (state): ExportPreferences => ({
        sizeTier: state.sizeTier,
        logoId: state.logoId,
        logoSize: state.logoSize
      }),
      // 读取同样只信白名单:手工改过的 storage 与旧版本残留都不允许复活 status/files。
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ExportPreferences>;
        return {
          ...current,
          sizeTier: isSizeTierKey(saved.sizeTier) ? saved.sizeTier : current.sizeTier,
          logoId: typeof saved.logoId === "string" ? saved.logoId : current.logoId,
          logoSize: isLogoSize(saved.logoSize) ? saved.logoSize : current.logoSize
        };
      }
    }
  )
);
