/**
 * 渲染引擎跨模块契约(唯一事实源)。
 *
 * 本文件由 Wave 0 冻结:后续所有 `src/utils/frame/**` 模块的实现签名必须与本文件的
 * 函数类型别名一致(实现侧写 `export const xxx: XxxFn = ...` 以获得编译期校验)。
 * 需要调整契约时改本文件并同步全部实现,不得在各自模块里私改形状。
 *
 * 追加记录(阶段 10,由导出流水线提出):`RenderFrameBatch` / `RunFrameExport` 尾部各追加一个
 * 可选入参 `cancel?: CancelToken`。原因是 `CancelToken` 自 Wave 0 起就无人消费——取消只能由
 * 流水线内部发起,页面的「取消」按钮因此无处接线;追加可选参数不动既有调用方与返回类型。
 */

// ---------------------------------------------------------------- 输出档位(D3)

export type SizeTierKey = "original" | "medium" | "small";

export interface SizeTierDefinition {
  /** 表单展示名 */
  readonly label: string;
  /** 表单副提示文案 */
  readonly hint: string;
  /** 输出像素总量上限,超过则等比缩小 */
  readonly maxPixels: number;
}

export const SIZE_TIERS = {
  original: { label: "原图", hint: "最大 2400 万像素", maxPixels: 24_000_000 },
  medium: { label: "中", hint: "1200 万像素", maxPixels: 12_000_000 },
  small: { label: "小", hint: "300 万像素", maxPixels: 3_000_000 }
} as const satisfies Record<SizeTierKey, SizeTierDefinition>;

export const SIZE_TIER_KEYS: readonly SizeTierKey[] = ["original", "medium", "small"];

export const DEFAULT_SIZE_TIER: SizeTierKey = "medium";

/** JPEG 编码质量三档恒定(D3:档位只改尺寸,不改质量)。 */
export const JPEG_QUALITY = 0.92;

/** 实时预览固定按长边渲染,与导出档位无关(D18)。 */
export const PREVIEW_LONG_EDGE = 1200;

// ---------------------------------------------------------------- logo 大小

/**
 * 「logo大小」滑杆档位:5–10 整数,步长 1。
 * 10 = 基准档(绘制几何与 `FRAME_GEOMETRY.logoHeight/logoWidth` 完全一致,即滑杆引入前的观感),
 * 渲染时换算成比例 `logoSize / LOGO_SIZE_MAX` 乘在 logo 高/宽外接框上——几何仍是纯比例(D4)。
 */
export const LOGO_SIZE_MIN = 5;
export const LOGO_SIZE_MAX = 10;
export const DEFAULT_LOGO_SIZE = LOGO_SIZE_MAX;

// ---------------------------------------------------------------- 绘制数据

/** exifr 解析后的相机元数据;字段缺失即不绘制。 */
export interface PhotoExif {
  cameraMake?: string;
  cameraModel?: string;
  lens?: string;
  iso?: number;
  /** 已格式化为 `f/2.8` 形态 */
  aperture?: string;
  /** 已格式化为 `1/250s` 或 `2s` 形态 */
  shutter?: string;
  /** 已格式化为 `35mm` 形态 */
  focalLength?: string;
  capturedAt?: string;
}

/** 相框信息条实际绘制的文案,全部可选。 */
export interface FrameFields {
  brand?: string;
  model?: string;
  lens?: string;
  focalLength?: string;
  /** `焦距  光圈  快门  ISO` 拼接后的参数行(绘制时与 focalLength 同处第一行) */
  exposure?: string;
}

export interface OutputSize {
  width: number;
  height: number;
}

// ---------------------------------------------------------------- 相框样式(D2)

/** 样式实现:JSON 清单只给 id,具体绘制走代码分支(注册表见 style-registry.ts)。 */
export interface FrameStyleDefinition {
  readonly id: string;
  /** 该样式的完整绘制实现,签名即 DrawFrameComposition */
  readonly draw: DrawFrameComposition;
}

/** 图片位图 + 已解码 logo,画布坐标系为输出尺寸。 */
export type DrawFrameComposition = (
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  image: ImageBitmap,
  fields: FrameFields,
  logo?: LogoRenderInput
) => void;

/** logo 渲染输入:优先位图,缺位图时用文字块兜底;scale 为 logo 大小比例(缺省 1 = 基准档)。 */
export interface LogoRenderInput {
  readonly mark: string;
  readonly bitmap?: ImageBitmap;
  readonly scale?: number;
}

// ---------------------------------------------------------------- 字体(D9)

export interface FontAsset {
  /** FontFace family 名,与 frame-drawing 里的 font-family 字面量一致 */
  readonly family: string;
  readonly weight: number;
  /** 相对 public 根的资源路径,消费侧经 assetUrl() 拼 assetPrefix */
  readonly path: string;
}

export type LoadFrameFonts = (scope: Document | typeof globalThis) => Promise<boolean>;

// ---------------------------------------------------------------- 能力探测(D6)

/** 单次导出全部任务可用的内存预算(字节)。 */
export const MEMORY_BUDGET_DESKTOP = 512 * 1024 * 1024;
export const MEMORY_BUDGET_MOBILE = 128 * 1024 * 1024;

/** 一个在途任务占用的经验内存:源图解码位图 + 输出位图 + 编码缓冲。 */
export const BYTES_PER_PIXEL_JOB = 8;

/** 并行上限,超过后收益递减且内存吃紧。 */
export const MAX_CONCURRENCY = 4;

/**
 * 浏览器 canvas 面积上限候选,从大到小探测。
 * 上界刻意停在 24MP(最高档的输出上限):再大的画布本工具用不到,
 * 而为 268M 像素分配探测缓冲(约 1GB)本身就是移动端崩溃风险。
 */
export const CANVAS_AREA_CANDIDATES: readonly number[] = [
  25_165_824, 16_777_216, 8_388_608, 4_194_304, 2_097_152
];

/** 探测全部失败时的保守兜底面积(2MP),保证返回值恒为正数。 */
export const FALLBACK_CANVAS_AREA = 2_097_152;

export type ProbeMaxCanvasArea = () => Promise<number>;
export type ResolveOutputSize = (
  sourceWidth: number,
  sourceHeight: number,
  tier: SizeTierKey,
  maxCanvasArea: number
) => OutputSize;
export type MemoryAwareConcurrency = (width: number, height: number, jobCount: number) => number;
export type IsMobileEnvironment = () => boolean;
export type SupportsWorkerRendering = () => boolean;

// ---------------------------------------------------------------- EXIF(D8)

/** EXIF 的 APP1 段固定在 JPEG 头部,读前 256KB 足够。 */
export const EXIF_HEAD_BYTES = 256 * 1024;

export type ReadHeadBytes = (file: Blob) => Promise<Uint8Array | null>;

/** 以源图 APP1 为底,修正 Orientation→1 与像素尺寸,产出可直接拼接的 APP1 段。 */
export type BuildExifApp1 = (
  head: Uint8Array | null,
  width: number,
  height: number
) => Uint8Array | null;

/** 零拷贝拼接:在 SOS 段前插入 APP1,不走 piexifjs 的 latin1 全文件字符串化。 */
export type SpliceExifIntoJpeg = (jpeg: Blob, app1: Uint8Array | null) => Promise<Blob>;

export type ExtractPhotoExif = (file: Blob) => Promise<PhotoExif>;
export type FrameFieldsFromExif = (exif?: PhotoExif) => FrameFields;

// ---------------------------------------------------------------- 任务与产物

/** 单张待渲染任务;字节已在主线程就绪,Worker 内不再发请求。 */
export interface FrameJob {
  readonly id: string;
  /** 输出主名(已 sanitize,不含扩展名) */
  readonly fileName: string;
  readonly blob: Blob;
  readonly fields: FrameFields;
  /** 源图头部字节,用于 EXIF 继承;无则 null */
  readonly exifHead: Uint8Array | null;
}

export interface FrameRenderSettings {
  readonly tier: SizeTierKey;
  readonly styleId: string;
  /** 文字兜底始终需要;bitmap 由渲染侧解码 */
  readonly logoMark: string;
  readonly logoBlob: Blob | null;
  /** logo大小滑杆档位(LOGO_SIZE_MIN..LOGO_SIZE_MAX) */
  readonly logoSize: number;
}

/** 单张渲染结果。`fileName` 恒为 `${主名}.jpg`(zip 内同名追加 -2/-3)。 */
export interface FrameTaskResult {
  readonly jobId: string;
  readonly fileName: string;
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly usedWorker: boolean;
  readonly exifInjected: boolean;
}

export interface FrameFailure {
  readonly jobId: string;
  readonly fileName: string;
  readonly message: string;
}

export interface FrameOutcome {
  readonly results: readonly FrameTaskResult[];
  readonly failures: readonly FrameFailure[];
}

export interface FrameExportSummary {
  readonly zip: Blob;
  readonly zipFileName: string;
  readonly succeeded: number;
  readonly total: number;
  readonly failures: readonly FrameFailure[];
}

export interface FrameProgressHandlers {
  onJobDone?(result: FrameTaskResult): void;
  onJobFailed?(failure: FrameFailure): void;
}

/**
 * 批次渲染。`cancel` 为阶段 10 追加的可选入参(见文件头追加记录):
 * 收到取消后停止派发新任务、reject 在途任务,并抛出可识别的取消错误。
 */
export type RenderFrameBatch = (
  jobs: readonly FrameJob[],
  settings: FrameRenderSettings,
  handlers?: FrameProgressHandlers,
  cancel?: CancelToken
) => Promise<FrameOutcome>;

/** 端到端导出:准备任务 → 定尺寸与并发 → 渲染 → 流式 zip → 汇总。`cancel` 同上。 */
export type RunFrameExport = (
  files: readonly File[],
  settings: FrameRenderSettings,
  handlers?: FrameProgressHandlers,
  cancel?: CancelToken
) => Promise<FrameExportSummary>;

/** 取消信号由导出弹框持有;池收到后停止派发新任务并 reject 在途任务。 */
export interface CancelToken {
  readonly cancelled: boolean;
  cancel(): void;
  onChange(listener: () => void): void;
}

// ---------------------------------------------------------------- Worker 消息协议

/** 主线程 → Worker。目标尺寸已在主线程算好,Worker 内做解码期缩放(D20)。 */
export interface FrameRenderRequest {
  readonly fileName: string;
  readonly blob: Blob;
  /** null 表示按源图尺寸输出 */
  readonly target: OutputSize | null;
  readonly jpegQuality: number;
  readonly styleId: string;
  readonly fields: FrameFields;
  readonly exifHead: Uint8Array | null;
  readonly logoMark: string;
  readonly logoBlob: Blob | null;
  /** logo大小滑杆档位,渲染侧换算成 scale = logoSize / LOGO_SIZE_MAX */
  readonly logoSize: number;
}

/** Worker → 主线程的产物;EXIF 已在 Worker 内注入。 */
export interface FrameWorkerResult {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly exifInjected: boolean;
}

export type FrameWorkerMessage =
  | { readonly type: "render"; readonly id: number; readonly request: FrameRenderRequest }
  | { readonly type: "result"; readonly id: number; readonly result: FrameWorkerResult }
  | { readonly type: "error"; readonly id: number; readonly message: string };

/**
 * Worker 池对外契约(阶段 9 实现 `FrameWorkerPool`,阶段 10 只经这个接口消费)。
 * 池自己决定任务落到哪个 worker、何时扩容、如何取消。
 */
export interface FrameWorkerPoolLike {
  /** 派发一份渲染请求;Worker 报错即 reject(由流水线收敛成单张失败) */
  render(request: FrameRenderRequest): Promise<FrameWorkerResult>;
  /** 停止派发新任务并 reject 全部在途任务 */
  cancel(): void;
  /** 销毁全部 Worker,池不可再用 */
  terminate(): void;
  /** 已创建的 Worker 数量 */
  readonly size: number;
}

export type CreateFrameWorkerPool = (concurrency: number) => FrameWorkerPoolLike;

/**
 * 单张渲染的共用内核:Worker 路径与主线程降级路径都调它,只有画布类型不同
 * (决策 D6:降级必须存在且被测试覆盖,两条路径产出必须一致)。
 */
export type RenderFrameCore = (
  request: FrameRenderRequest,
  surface: RenderSurface
) => Promise<FrameWorkerResult>;

/** 渲染面:Worker 用 OffscreenCanvas,主线程用普通 canvas 的 2d context。 */
export interface RenderSurface {
  createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement;
  loadFonts(): Promise<boolean>;
}

/** 解码期缩放(决策 D20):不支持 resizeWidth/Height 的环境退回全尺寸解码。 */
export type DecodeImageScaled = (blob: Blob, target: OutputSize | null) => Promise<ImageBitmap>;

// ---------------------------------------------------------------- 通用工具契约

export type AssetUrl = (path: string) => string;
export type SanitizeBaseName = (name: string) => string;
export type UniqueName = (used: ReadonlySet<string>, candidate: string) => string;
export type DownloadBlob = (blob: Blob, fileName: string) => void;
