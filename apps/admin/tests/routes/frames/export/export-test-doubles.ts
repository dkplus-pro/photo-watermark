// 导出页(阶段 13)用例共用的**模块边界替身**与**纯数据夹具**。
//
// 硬约束:本文件**不许 import 任何 src 运行期代码**(只允许 `import type` 与
// `utils/frame/export-cancel` 这类零依赖纯工具)。
// 原因是 ESM 的求值顺序:`vi.mock` 的工厂在「被 mock 的模块被求值的那一刻」执行,而测试脚手架
// 自身一 import `src/store/export`,就会顺着
// `store/export → utils/frame/style-registry → frame-drawing → fonts → utils/asset-url`
// 这条链去求值被替掉的 `asset-url` —— 那一刻工厂要读的 `exportTestDoubles` 还没初始化完,
// 直接就是 `Cannot access '__vi_import_N__' before initialization`。
// 所以带 store / 注册表依赖的那一半留在 `./export-test-harness.ts`,由它 import 本文件后再转出。
//
// 打桩的边界:
// - `export-pipeline`(唯一的长任务入口)只替 `runFrameExport` 与 `probeSourceSize`;
//   `createCancelToken`/`isCancelledExport`/`CancelledExportError` **用真实实现**——
//   「令牌点一次就置位」「取消错误可被识别」正是要验的因果,替身会把它们糊掉;
// - 四个表单子组件(阶段 11 交付)替成记录 props 的空壳,页面用例因此不依赖它们的实现进度;
// - `use-frame-catalog`(清单装载)、`use-responsive`(断点)、`download`、`asset-url`、`fields` 全替。
//
// **替身函数只创建一次**:源码里的 `import { x } from "mocked"` 拿到的是 mock 工厂执行那一刻
// 的函数引用,事后把属性换成新的 `vi.fn()` 会让实现改不动(测试假绿)。所以用例只用
// `mockImplementation` / `mockResolvedValue` 改行为,收尾调 `resetExportTestDoubles()` 复位默认实现。
import { createElement } from "react";
import { vi } from "vitest";

import {
  CancelledExportError,
  createCancelToken,
  isCancelledExport
} from "../../../../src/utils/frame/export-cancel";
import type { FrameCatalogEntry, LogoCatalogEntry } from "../../../../src/types";
import type {
  DownloadBlob,
  ExtractPhotoExif,
  FrameExportSummary,
  FrameFailure,
  FrameFieldsFromExif,
  FrameTaskResult,
  MakePhotoThumbnail,
  OutputSize,
  RunFrameExport
} from "../../../../src/utils/frame/types";

// ---------------------------------------------------------------- 清单条目夹具

export function makeFrameEntry(id: string, name: string): FrameCatalogEntry {
  return { id, name, thumbnail: `assets/thumbs/${id}.svg`, sortOrder: 1 };
}

/** 预设 logo:`source` 按 id 派生且各不相同,免得模块级预设缓存把「只取一次」的用例串味。 */
export function makeLogoEntry(id: string, mark: string): LogoCatalogEntry {
  return { id, name: `预设 ${id}`, source: `assets/logos/${id}.svg`, mark };
}

/**
 * 清单默认值的可写槽位。样式清单的默认项要用真实注册表里的 id(那一半在 harness 里,
 * 因为它必须 import style-registry),故本文件只留空槽,harness 装载时填进来。
 */
export const catalogDefaults = {
  frames: [] as FrameCatalogEntry[],
  logos: [makeLogoEntry("juzi", "JUZI"), makeLogoEntry("studio", "STUDIO")]
};

export const DEFAULT_LOGOS: LogoCatalogEntry[] = catalogDefaults.logos;

// ---------------------------------------------------------------- 文件与结果夹具

let fileSequence = 0;

/** 造一张可受理的图片 File(名字与 lastModified 都唯一,免得 store 判重把两次选择并成一条)。 */
export function makeImageFile(name?: string): File {
  fileSequence += 1;
  return new File(
    [new Uint8Array([0xff, 0xd8, 0xff, 0xda])],
    name ?? `photo-${String(fileSequence)}.jpg`,
    {
      type: "image/jpeg",
      lastModified: 1_700_000_000_000 + fileSequence
    }
  );
}

export function makeSummary(overrides: Partial<FrameExportSummary> = {}): FrameExportSummary {
  return {
    zip: new Blob(["zip-bytes"], { type: "application/zip" }),
    zipFileName: "frame-export-2026-09-23.zip",
    succeeded: 2,
    total: 2,
    failures: [],
    ...overrides
  };
}

export function makeFailure(fileName: string, message: string): FrameFailure {
  return { jobId: `job-${fileName}`, fileName, message };
}

export function makeTaskResult(jobId: string): FrameTaskResult {
  return {
    jobId,
    fileName: `${jobId}.jpg`,
    blob: new Blob(["jpg"]),
    width: 4000,
    height: 3000,
    usedWorker: true,
    exifInjected: true
  };
}

/** 挂起的 promise + 其 resolve/reject,用于把异步推进到用例指定的时刻。 */
export function makeDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------- 模块边界替身

// 替身一律按契约类型参数化:用例要靠 `mock.calls` 拿到**带名字的四元组**入参,
// 无类型的 `vi.fn()` 会把参数元组推成 `[]`,断言侧只能靠 `as` 硬转,错了也不报。
const probeSize: (file: Blob) => Promise<OutputSize | null> = async () => ({
  width: 4000,
  height: 3000
});
const defaultExif: ExtractPhotoExif = async () => ({ cameraMake: "SONY" });
const defaultFields: FrameFieldsFromExif = () => ({ brand: "SONY" });
// 与真实实现同语义:尺寸未知 → 不产缩略图(返回 null),列表退回直显原图。
const defaultThumbnail: MakePhotoThumbnail = async (_file, sourceSize) =>
  sourceSize ? new Blob(["thumb-bytes"], { type: "image/jpeg" }) : null;

export const exportTestDoubles = {
  catalog: {
    frames: [] as FrameCatalogEntry[],
    logos: DEFAULT_LOGOS,
    loading: false,
    error: null as string | null,
    reload: vi.fn(async (): Promise<void> => undefined)
  },
  responsive: { isMobile: false, isTablet: false },
  assetUrl: vi.fn((path: string) => `/${path}`),
  downloadBlob: vi.fn<DownloadBlob>(),
  fetch: vi.fn(),
  runFrameExport: vi.fn<RunFrameExport>(async () => makeSummary()),
  probeSourceSize: vi.fn(probeSize),
  extractPhotoExif: vi.fn<ExtractPhotoExif>(defaultExif),
  frameFieldsFromExif: vi.fn<FrameFieldsFromExif>(defaultFields),
  makePhotoThumbnail: vi.fn<MakePhotoThumbnail>(defaultThumbnail),
  // 真实取消语义,只是换个入口名暴露给页面(见文件头)。
  createCancelToken,
  isCancelledExport,
  CancelledExportError,
  NO_FILES_ERROR_MESSAGE: "没有可导出的图片, 请先选择至少一张照片。",
  CANCELLED_ERROR_MESSAGE: "导出已取消。",
  noSuccessMessage: (total: number): string =>
    `没有一张图片导出成功: 全部 ${String(total)} 张都失败了。`
};

/** 每个用例开头调一次:清单回到默认、替身实现回到默认,调用计数清零。 */
export function resetExportTestDoubles(): void {
  const { catalog, responsive, runFrameExport, probeSourceSize } = exportTestDoubles;
  catalog.frames = catalogDefaults.frames;
  catalog.logos = catalogDefaults.logos;
  catalog.loading = false;
  catalog.error = null;
  catalog.reload.mockReset();
  responsive.isMobile = false;
  responsive.isTablet = false;
  exportTestDoubles.assetUrl.mockClear();
  exportTestDoubles.downloadBlob.mockReset();
  exportTestDoubles.fetch.mockReset();
  exportTestDoubles.extractPhotoExif.mockReset();
  exportTestDoubles.extractPhotoExif.mockImplementation(defaultExif);
  exportTestDoubles.frameFieldsFromExif.mockReset();
  exportTestDoubles.frameFieldsFromExif.mockImplementation(defaultFields);
  exportTestDoubles.makePhotoThumbnail.mockReset();
  exportTestDoubles.makePhotoThumbnail.mockImplementation(defaultThumbnail);
  probeSourceSize.mockReset();
  probeSourceSize.mockImplementation(probeSize);
  // 不补默认实现的话 mockReset() 之后调用返回 undefined,用例会在 `summary.zip` 上炸出
  // 与被测逻辑无关的 TypeError —— 假失败最难查。
  runFrameExport.mockReset();
  runFrameExport.mockImplementation(async () => makeSummary());
}

// ---------------------------------------------------------------- 子组件替身

interface StubRegistry {
  props: Record<string, object>;
}

const pickerRegistry: StubRegistry = { props: {} };

/**
 * 生成一个记录 props 的空壳子组件。
 * 桩渲染 `<section data-picker="label">`:用例既能在 DOM 里断言「表单装上了」,
 * 又能拿最新 props 直接调它的回调(`pickerProps<ImagePickerProps>("image").onAdd([file])`),
 * 不必去模拟文件选择框(那是阶段 11 的用例范围)。
 */
export function makePickerStub<T extends object>(label: string) {
  return function PickerStub(props: T) {
    pickerRegistry.props[label] = props;
    return createElement("section", { "data-picker": label });
  };
}

export function pickerProps<T extends object>(label: string): T {
  const recorded = pickerRegistry.props[label];
  if (!recorded) throw new Error(`子组件替身 "${label}" 尚未渲染`);
  return recorded as T;
}

export function resetPickerRegistry(): void {
  pickerRegistry.props = {};
}
