// 导出页装配用例(阶段 13,`src/routes/frames/[styleId]/export/page.tsx`)。
//
// 只验「装配」这一层:地址守卫的四级判定、preparing 的归属、点导出到 downloadBlob 的完整时序、
// 取消与失败的分支、logo 三态到渲染入参的映射、栅格与移动端软提示。
// 四个子组件(阶段 11)按契约替成记录 props 的空壳(替身与夹具全部来自 `./export-test-harness`),
// 用例从空壳拿 props 直接调回调,所以本文件与它们的实现进度无关;
// 绘制与打包另有阶段 9/10 的用例,`use-export-flow` / `style-guard` / `logo-settings` /
// `use-file-preparation` 各有自己的用例,这里保留同样几条时序断言 —— 页面是它们唯一的调用方,
// 装配错了只有在这里会露出来。
//
// 六类边界覆盖:
//   空值 —— 地址缺 styleId、一张图没选、探测读不到尺寸;
//   零值 —— 空批次不进弹框;0 字节的自定义 logo 不喂解码器;
//   越界 —— 清单登记了但注册表没实现;清单外的预设 id 当无 logo;在途流水线只允许一条;
//   权限缺失 —— 不适用:本 app 匿名公开、无登录无权限码(apps/admin/AGENTS.md 第 3 节)。
//              本页唯一的「准入」是地址样式守卫,已由「装载失败优先」与三条「样式不存在」用例覆盖;
//   网络失败 —— 清单装载失败给重试而不是「样式不存在」;预设 logo 取不回(非 2xx 与 reject 两条路)
//              只降级成文字块,不整页失败;
//   非法状态迁移 —— exporting 中重复点导出、探测未完就卸载、取消后再收到 onJobDone、
//                  样式 id 非法时不许把 store 里的残留样式当成用户选择(绝不静默回落)。
//
// 行数豁免(apps/admin/AGENTS.md 第 9 节「测试文件的唯一豁免」):本文件只覆盖 **一个** 被测模块
// (page.tsx 的装配)。再按关注点拆,要么把同一次渲染的同一个上下文切成三四份、要么在每个兄弟文件
// 里重抄一遍受提升语义限制的 vi.mock 形状(九条 mock 边界),只会制造漂移。
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// arco 内部走 findDOMNode(React 19 已移除);真机由 routes/layout.tsx 补适配层,这里同口径。
import "@arco-design/web-react/es/_util/react-19-adapter";

// 脚手架必须排在被测源码之前:下面的 vi.mock 工厂引用它的替身对象(vi.mock 会被提到顶部注册,
// 但工厂在被 mock 的模块被求值那一刻才执行,顺序错了就是 TDZ)。
import {
  CUSTOM_LOGO_ID,
  DEFAULT_FRAMES,
  DEFAULT_LOGOS,
  NO_LOGO_ID,
  REGISTERED_STYLE_ID,
  UNREGISTERED_STYLE_ID,
  exportTestDoubles,
  makeDeferred,
  makeFailure,
  makeFrameEntry,
  makeImageFile,
  makeLogoEntry,
  makePickerStub,
  makeSummary,
  makeTaskResult,
  pickerProps,
  resetExportStore,
  resetExportTestDoubles,
  resetPickerRegistry,
  storeFiles,
  storeState
} from "./export-test-harness";
import { MOBILE_SOFT_LIMIT, useExportStore } from "../../../../src/store/export";
import { CancelledExportError } from "../../../../src/utils/frame/export-cancel";
import { DEFAULT_LOGO_SIZE } from "../../../../src/utils/frame/types";
import type {
  CancelToken,
  FrameExportSummary,
  FrameProgressHandlers,
  FrameRenderSettings,
  OutputSize
} from "../../../../src/utils/frame/types";
import type { FramePreviewProps } from "../../../../src/routes/frames/[styleId]/export/components/frame-preview";
import type { ImagePickerProps } from "../../../../src/routes/frames/[styleId]/export/components/image-picker";
import type { LogoPickerProps } from "../../../../src/routes/frames/[styleId]/export/components/logo-picker";
import type { SizeTierPickerProps } from "../../../../src/routes/frames/[styleId]/export/components/size-tier-picker";

/** 地址参数与跳转:本页仅有的两个框架入口。 */
const routerDouble = vi.hoisted(() => ({
  params: {} as Record<string, string | undefined>,
  navigate: vi.fn()
}));

vi.mock("@modern-js/runtime/router", () => ({
  useParams: () => routerDouble.params,
  useNavigate: () => routerDouble.navigate,
  useLocation: () => ({ pathname: "/frames" })
}));

// 唯一的长任务入口:只替 runFrameExport 与 probeSourceSize,取消三件套走 doubles 里的真实实现 ——
// 「令牌点一次就置位」「取消错误可被识别」正是要验的因果,替身会把它们糊掉。
vi.mock("../../../../src/utils/frame/export-pipeline", () => ({ ...exportTestDoubles }));
vi.mock("../../../../src/utils/frame/fields", () => ({
  extractPhotoExif: exportTestDoubles.extractPhotoExif,
  frameFieldsFromExif: exportTestDoubles.frameFieldsFromExif
}));
vi.mock("../../../../src/hooks/use-frame-catalog", () => ({
  useFrameCatalog: () => exportTestDoubles.catalog
}));
vi.mock("../../../../src/hooks/use-responsive", () => ({
  useIsMobile: () => exportTestDoubles.responsive.isMobile,
  useIsTablet: () => exportTestDoubles.responsive.isTablet
}));
// 静态资源一律经 assetUrl(D11)、下载产物是本页唯一的外部副作用 —— 两个都要能断言。
// **必须写成调用期闭包**:harness 一 import `store/export`,就顺着
// store → style-registry → frame-drawing → fonts → asset-url 把这两个工厂拽出来求值,
// 那一刻 harness 还没走完,工厂里直接读 exportTestDoubles 就是
// "Cannot access '__vi_import_N__' before initialization"(一条用例都跑不起来)。
vi.mock("../../../../src/utils/asset-url", () => ({
  assetUrl: (path: string) => exportTestDoubles.assetUrl(path)
}));
vi.mock("../../../../src/utils/download", () => ({
  downloadBlob: (...args: [Blob, string]) => exportTestDoubles.downloadBlob(...args)
}));

// 四个子组件替成空壳:DOM 里留 [data-picker] 标记,props 记进脚手架的注册表。
// default 与具名都给:page.tsx 用 default,但模块形状要和真身一致才不漏后续具名引用。
vi.mock("../../../../src/routes/frames/[styleId]/export/components/image-picker", () => {
  const stub = makePickerStub("image");
  return { default: stub, ImagePicker: stub };
});
vi.mock("../../../../src/routes/frames/[styleId]/export/components/size-tier-picker", () => {
  const stub = makePickerStub("tier");
  return { default: stub, SizeTierPicker: stub };
});
vi.mock("../../../../src/routes/frames/[styleId]/export/components/logo-picker", () => {
  const stub = makePickerStub("logo");
  return { default: stub, LogoPicker: stub };
});
vi.mock("../../../../src/routes/frames/[styleId]/export/components/frame-preview", () => {
  const stub = makePickerStub("preview");
  return { default: stub, FramePreview: stub };
});

import FrameExportPage from "../../../../src/routes/frames/[styleId]/export/page";

/** 页面右上角主按钮的文案(page.tsx 里就是这两个字)。 */
const EXPORT_BUTTON = "导出";

interface CapturedRun {
  files: readonly File[];
  settings: FrameRenderSettings;
  handlers: FrameProgressHandlers;
  token: CancelToken;
  succeed: (summary: FrameExportSummary) => void;
  fail: (error: Error) => void;
}

const runs: CapturedRun[] = [];

/** 把流水线换成「挂起、由用例推进」的替身:逐张回报、完成、失败、取消都在用例手里。 */
function installPipelineDouble(): void {
  exportTestDoubles.runFrameExport.mockImplementation((files, settings, handlers, token) => {
    // 契约里 handlers/cancel 是可选形参,但页面必须传满 —— 少传一个就是装配 bug,
    // 与其让后面的 `token.onChange` 抛裸 TypeError,不如在这里点名是哪一环断了。
    if (!handlers || !token) throw new Error("导出页未向流水线传入 handlers/cancel");
    const deferred = makeDeferred<FrameExportSummary>();
    token.onChange(() => deferred.reject(new CancelledExportError()));
    runs.push({
      files,
      settings,
      handlers,
      token,
      succeed: deferred.resolve,
      fail: deferred.reject
    });
    return deferred.promise;
  });
}

/**
 * 直接给定地址参数:「地址缺段」必须显式给 `{}` —— 传 `undefined` 会被默认参数吃掉,
 * 于是验的就不再是缺段那一条分支。
 */
function renderPageWithParams(params: Record<string, string | undefined>) {
  routerDouble.params = params;
  return render(<FrameExportPage />);
}

function renderExportPage(styleId: string = REGISTERED_STYLE_ID) {
  return renderPageWithParams({ styleId });
}

function previewProps(): FramePreviewProps {
  return pickerProps<FramePreviewProps>("preview");
}

function makeFiles(count: number): File[] {
  return Array.from({ length: count }, () => makeImageFile());
}

function pushFiles(files: File[]): void {
  act(() => {
    pickerProps<ImagePickerProps>("image").onAdd(files);
  });
}

/** 走完「入队 → 探测 → 回 idle」这段准备期:preparing 的进出由页面拥有(store 不加这个动作)。 */
async function addPreparedFiles(count: number): Promise<File[]> {
  const files = makeFiles(count);
  pushFiles(files);
  await waitFor(() => expect(storeState().status).toBe("idle"));
  return files;
}

async function clickExport(): Promise<CapturedRun> {
  await userEvent.click(screen.getByRole("button", { name: EXPORT_BUTTON }));
  const run = runs[runs.length - 1];
  if (!run) throw new Error("点「导出」后没有调流水线");
  return run;
}

/** 预设 logo 的同源取回:成功给非空 Blob,失败按非 2xx 形状给。 */
function stubPresetFetch(ok: boolean): void {
  exportTestDoubles.fetch.mockImplementation(async () =>
    ok
      ? { ok: true, blob: async () => new Blob(["<svg/>"], { type: "image/svg+xml" }) }
      : { ok: false, status: 404, blob: async () => new Blob() }
  );
}

/** 主布局 Row 下的两个 Col(表单列 / 预览列),数组顺序即 DOM(=视觉)顺序。 */
function layoutCols(container: HTMLElement): HTMLElement[] {
  const row = container.querySelector<HTMLElement>(".export-layout");
  if (!row) throw new Error("主布局 Row 未渲染");
  return Array.from(row.children).filter((node) =>
    (node as HTMLElement).className.includes("arco-col")
  ) as HTMLElement[];
}

/** arco Col 的 span 落在类名上(arco-col-16 / -8),用它断言列宽。 */
function spanOf(col: HTMLElement): string {
  return col.className.match(/arco-col-(\d+)/u)?.[1] ?? "";
}

/** 某个范围里装了哪些子组件替身,顺序即 DOM 顺序。 */
function pickerLabelsIn(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll("[data-picker]")).map(
    (node) => node.getAttribute("data-picker") ?? ""
  );
}

beforeEach(() => {
  resetExportTestDoubles();
  resetPickerRegistry();
  resetExportStore();
  installPipelineDouble();
  routerDouble.params = { styleId: REGISTERED_STYLE_ID };
  routerDouble.navigate.mockClear();
  runs.length = 0;
  // 本站唯一允许的 fetch 是取预设 logo(同源静态资源,D10),必须可断言。
  vi.stubGlobal("fetch", exportTestDoubles.fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("地址守卫", () => {
  test("清单装载中只给骨架:不渲染表单,导出按钮禁用(样式还没定,不该让用户点)", () => {
    exportTestDoubles.catalog.loading = true;
    const { container } = renderExportPage();

    expect(container.querySelector(".arco-skeleton")).not.toBeNull();
    expect(container.querySelectorAll("[data-picker]")).toHaveLength(0);
    expect(screen.getByRole("button", { name: EXPORT_BUTTON })).toBeDisabled();
  });

  test("网络失败:装载失败优先于「样式不存在」,给重试而不是让用户去改地址", async () => {
    // 装载失败态是 loading=false + error 非空,此时清单必然是空数组:
    // 两判定反过来写就会把一次 JSON 404 误报成「用户输错了样式 id」。
    exportTestDoubles.catalog.frames = [];
    exportTestDoubles.catalog.error = "frames.json 请求失败";
    const { container } = renderExportPage("id-also-unknown");

    expect(screen.getByText("相框清单装载失败")).toBeInTheDocument();
    expect(screen.getByText("frames.json 请求失败")).toBeInTheDocument();
    expect(screen.queryByText("样式不存在")).not.toBeInTheDocument();
    expect(container.querySelector(".arco-skeleton")).toBeNull();
    expect(container.querySelectorAll("[data-picker]")).toHaveLength(0);
    // 样式没定 → 导出按钮禁用,错误页不许留下可点的导出入口。
    expect(screen.getByRole("button", { name: EXPORT_BUTTON })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /重试/u }));
    expect(exportTestDoubles.catalog.reload).toHaveBeenCalledTimes(1);
  });

  test("空值:清单没这个 id 时整页 404,store 里的残留样式不被当成用户选择(不静默回落)", async () => {
    useExportStore.setState({ styleId: "stale-style" });
    renderExportPage("not-in-catalog");

    expect(screen.getByText("样式不存在")).toBeInTheDocument();
    expect(screen.getByText(/not-in-catalog/u)).toBeInTheDocument();
    expect(storeState().styleId).toBe("stale-style");
    expect(screen.queryByText("基础黑框")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /返回相框列表/u }));
    expect(routerDouble.navigate).toHaveBeenCalledWith("/frames");
  });

  test("越界:清单登记了但注册表没实现 —— 两份事实源漂移要显式报,不许就近换一款", () => {
    exportTestDoubles.catalog.frames = [
      ...DEFAULT_FRAMES,
      makeFrameEntry(UNREGISTERED_STYLE_ID, "未实现框")
    ];
    useExportStore.setState({ styleId: "stale-style" });
    renderExportPage(UNREGISTERED_STYLE_ID);

    expect(screen.getByText("样式不存在")).toBeInTheDocument();
    expect(screen.getByText(/样式注册表里没有它的绘制实现/u)).toBeInTheDocument();
    expect(storeState().styleId).toBe("stale-style");
  });

  test("空值:地址缺段(useParams 给不到 styleId)也按「样式不存在」处理,不渲染半张表单", () => {
    const { container } = renderPageWithParams({});

    expect(screen.getByText("样式不存在")).toBeInTheDocument();
    expect(screen.getByText(/地址里没有相框样式/u)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-picker]")).toHaveLength(0);
    expect(storeState().styleId).toBe(REGISTERED_STYLE_ID);
  });

  test("校验通过才写 store:styleId 落定、样式名回显、四件套与预览都装上", () => {
    useExportStore.setState({ styleId: "stale-style" });
    const { container } = renderExportPage();

    expect(storeState().styleId).toBe(REGISTERED_STYLE_ID);
    expect(screen.getByText("相框样式: 基础黑框")).toBeInTheDocument();
    expect(pickerLabelsIn(container)).toEqual(["image", "tier", "logo", "preview"]);
    expect(previewProps().styleId).toBe(REGISTERED_STYLE_ID);
  });
});

describe("图片准备(探测)", () => {
  test("新入队的图片:页面负责进 preparing、探完回 idle,尺寸与 EXIF 经 patchFile 落回 store", async () => {
    renderExportPage();
    pushFiles(makeFiles(2));
    expect(storeState().status).toBe("preparing");

    await waitFor(() => expect(storeState().status).toBe("idle"));
    expect(storeFiles().map((entry) => [entry.width, entry.height])).toEqual([
      [4000, 3000],
      [4000, 3000]
    ]);
    expect(storeFiles().every((entry) => entry.exif !== null && entry.exifReadAt !== null)).toBe(
      true
    );
    expect(exportTestDoubles.probeSourceSize).toHaveBeenCalledTimes(2);
    expect(exportTestDoubles.extractPhotoExif).toHaveBeenCalledTimes(2);
  });

  test("同一张图不重复探测(探测按 entry 记账,而不是按数组重渲染)", async () => {
    renderExportPage();
    const [file] = await addPreparedFiles(1);
    const probesBefore = exportTestDoubles.probeSourceSize.mock.calls.length;

    // 重选同一个 File:store 判重把它并掉,entry 没变 => 一次探测都不该再发。
    pushFiles([file as File]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(storeFiles()).toHaveLength(1);
    expect(exportTestDoubles.probeSourceSize).toHaveBeenCalledTimes(probesBefore);
  });

  test("零值:探不到尺寸保持 0(不编造 0×0 的假事实),页面照常可用", async () => {
    exportTestDoubles.probeSourceSize.mockImplementation(
      async (): Promise<OutputSize | null> => null
    );
    renderExportPage();
    await addPreparedFiles(1);

    expect(storeFiles()[0]).toMatchObject({ width: 0, height: 0 });
    expect(screen.getByRole("button", { name: EXPORT_BUTTON })).toBeEnabled();
  });

  test("busy 覆盖准备期:探测未完时表单四件套都被禁用,不给半截事实改的机会", async () => {
    const pending = makeDeferred<OutputSize | null>();
    exportTestDoubles.probeSourceSize.mockImplementation(() => pending.promise);
    renderExportPage();
    pushFiles(makeFiles(1));

    expect(storeState().status).toBe("preparing");
    expect(pickerProps<ImagePickerProps>("image").disabled).toBe(true);
    expect(pickerProps<SizeTierPickerProps>("tier").disabled).toBe(true);
    expect(pickerProps<LogoPickerProps>("logo").disabled).toBe(true);
    expect(pickerProps<FramePreviewProps>("preview").disabled).toBe(true);

    await act(async () => {
      pending.resolve({ width: 2000, height: 1000 });
      await Promise.resolve();
    });
    expect(storeState().status).toBe("idle");
    expect(pickerProps<ImagePickerProps>("image").disabled).toBe(false);
  });

  test("非法状态迁移:探测未完就卸载,晚到的结果不许把状态推进到导出或完成", async () => {
    const pending = makeDeferred<OutputSize | null>();
    exportTestDoubles.probeSourceSize.mockImplementation(() => pending.promise);
    const { unmount } = renderExportPage();

    pushFiles(makeFiles(1));
    expect(storeState().status).toBe("preparing");
    unmount();

    await act(async () => {
      pending.resolve({ width: 1, height: 1 });
      await Promise.resolve();
    });
    // 卸载后只剩「别把进度条点亮」这一条硬要求:preparing 是合法的滞留态(下次装载会清)。
    expect(["idle", "preparing"]).toContain(storeState().status);
    expect(storeState().zipFileName).toBeNull();
    expect(exportTestDoubles.downloadBlob).not.toHaveBeenCalled();
  });
});

describe("导出主流程", () => {
  test("空值:一张没选时点导出只给可读提示,不进 exporting、不开弹框", async () => {
    renderExportPage();

    await userEvent.click(screen.getByRole("button", { name: EXPORT_BUTTON }));

    expect(exportTestDoubles.runFrameExport).not.toHaveBeenCalled();
    expect(storeState().status).toBe("idle");
    expect(screen.queryByText("导出进度")).not.toBeInTheDocument();
    expect(screen.getByText(/还没有选择图片/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: EXPORT_BUTTON })).toBeEnabled();
  });

  test("点导出到下载:beginExport → 逐张回报 → finishExport → downloadBlob,产物字节不进 store", async () => {
    renderExportPage();
    const files = await addPreparedFiles(2);
    const summary = makeSummary({ zipFileName: "frame-export-2026-09-23.zip" });

    const run = await clickExport();
    expect(Array.from(run.files)).toEqual(files);
    expect(run.settings).toEqual({
      tier: "medium",
      styleId: REGISTERED_STYLE_ID,
      logoMark: "",
      logoBlob: null,
      logoSize: DEFAULT_LOGO_SIZE
    });
    expect(storeState()).toMatchObject({ status: "exporting", total: 2, done: 0, failedCount: 0 });
    expect(screen.getByText("导出进度")).toBeInTheDocument();

    act(() => run.handlers.onJobDone?.(makeTaskResult("job-1")));
    act(() => run.handlers.onJobDone?.(makeTaskResult("job-2")));
    expect(storeState().done).toBe(2);

    await act(async () => {
      run.succeed(summary);
    });
    expect(storeState()).toMatchObject({ status: "done", zipFileName: summary.zipFileName });
    expect(exportTestDoubles.downloadBlob).toHaveBeenCalledTimes(1);
    expect(exportTestDoubles.downloadBlob).toHaveBeenCalledWith(summary.zip, summary.zipFileName);
    // 产物只在页面的 ref 里活一次,store 里不许有字节(驻留 50 张成品就是内存事故)。
    expect(Object.values(storeState()).some((value) => value instanceof Blob)).toBe(false);
  });

  test("渲染入参跟随表单:表单改档位即刻写回 store,档位与样式 id 原样交给流水线", async () => {
    useExportStore.setState({ sizeTier: "small" });
    renderExportPage();
    await addPreparedFiles(1);

    act(() => pickerProps<SizeTierPickerProps>("tier").onChange("original"));
    expect(storeState().sizeTier).toBe("original");

    const run = await clickExport();
    expect(run.settings.tier).toBe("original");
    expect(run.settings.styleId).toBe(REGISTERED_STYLE_ID);
  });

  test("非法状态迁移:exporting 中连点两次导出只起一条流水线(两条会抢同一批 Worker)", async () => {
    renderExportPage();
    await addPreparedFiles(2);

    const first = await clickExport();
    await userEvent.click(screen.getByRole("button", { name: EXPORT_BUTTON }));
    expect(exportTestDoubles.runFrameExport).toHaveBeenCalledTimes(1);
    expect(storeState()).toMatchObject({ status: "exporting", total: 2 });

    await act(async () => {
      first.succeed(makeSummary());
    });
    expect(storeState().status).toBe("done");
  });

  test("D7:单张失败不拖垮整批,失败张数与文件名逐条进列表", async () => {
    renderExportPage();
    await addPreparedFiles(3);

    const run = await clickExport();
    act(() => run.handlers.onJobFailed?.(makeFailure("broken.jpg", "源图解码失败")));
    expect(storeState()).toMatchObject({ status: "exporting", failedCount: 1 });
    expect(screen.getByText("broken.jpg")).toBeInTheDocument();
    expect(screen.getByText("源图解码失败")).toBeInTheDocument();

    await act(async () => {
      run.succeed(makeSummary({ succeeded: 2, total: 3 }));
    });
    expect(storeState().status).toBe("done");
    expect(exportTestDoubles.downloadBlob).toHaveBeenCalledTimes(1);
  });

  test("上游失败:整批异常走 failExport,消息原文露出且不下载任何包", async () => {
    renderExportPage();
    await addPreparedFiles(2);

    const run = await clickExport();
    await act(async () => {
      run.fail(new Error("渲染引擎异常: Worker 全部退出"));
    });

    expect(storeState()).toMatchObject({
      status: "failed",
      error: "渲染引擎异常: Worker 全部退出"
    });
    expect(screen.getByText("导出失败")).toBeInTheDocument();
    expect(screen.getByText("渲染引擎异常: Worker 全部退出")).toBeInTheDocument();
    expect(exportTestDoubles.downloadBlob).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /关闭/u }));
    expect(storeState()).toMatchObject({ status: "idle", error: null, failures: [] });
  });

  test("越界:流水线抛空消息异常时兜底一句人话,不给用户 undefined", async () => {
    renderExportPage();
    await addPreparedFiles(1);

    const run = await clickExport();
    await act(async () => {
      run.fail(new Error("   "));
    });
    expect(storeState().error).toBe("导出失败: 未知错误, 请重试或改用更低档位。");
    expect(storeState().error).not.toBe("undefined");
  });

  test("非法状态迁移:取消只认 isCancelledExport 的判定,回 idle、不下载、不记失败", async () => {
    renderExportPage();
    await addPreparedFiles(4);

    const run = await clickExport();
    act(() => run.handlers.onJobDone?.(makeTaskResult("job-1")));
    expect(storeState().done).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: /取消导出/u }));
    expect(run.token.cancelled).toBe(true);
    await waitFor(() => expect(storeState().status).toBe("idle"));
    expect(storeState()).toMatchObject({ error: null, failedCount: 0, zipFileName: null });
    // 取消时保留已完成计数:用户要看到「跑到第几张时停的」。
    expect(storeState().done).toBe(1);
    expect(exportTestDoubles.downloadBlob).not.toHaveBeenCalled();
  });

  test("非法状态迁移:取消后晚到的 onJobDone/onJobFailed 不许让进度复活", async () => {
    renderExportPage();
    await addPreparedFiles(2);

    const run = await clickExport();
    act(() => run.handlers.onJobDone?.(makeTaskResult("job-1")));
    await userEvent.click(screen.getByRole("button", { name: /取消导出/u }));
    await waitFor(() => expect(storeState().status).toBe("idle"));

    act(() => run.handlers.onJobDone?.(makeTaskResult("late-1")));
    act(() => run.handlers.onJobFailed?.(makeFailure("late-2.jpg", "已取消")));
    expect(storeState()).toMatchObject({ status: "idle", done: 1, failedCount: 0, failures: [] });
  });

  test("取消后仍能重开:令牌按次新建,上一条的取消信号不许锁死页面", async () => {
    renderExportPage();
    await addPreparedFiles(1);

    const first = await clickExport();
    await userEvent.click(screen.getByRole("button", { name: /取消导出/u }));
    await waitFor(() => expect(storeState().status).toBe("idle"));

    const second = await clickExport();
    expect(second.token).not.toBe(first.token);
    expect(first.token.cancelled).toBe(true);
    expect(second.token.cancelled).toBe(false);
    expect(exportTestDoubles.runFrameExport).toHaveBeenCalledTimes(2);
  });

  test("重新下载拿同一个产物引用;关闭弹框后进度归零、图片还在", async () => {
    renderExportPage();
    await addPreparedFiles(2);

    const run = await clickExport();
    const summary = makeSummary();
    await act(async () => {
      run.succeed(summary);
    });
    await userEvent.click(screen.getByRole("button", { name: /重新下载/u }));
    expect(exportTestDoubles.downloadBlob).toHaveBeenCalledTimes(2);
    expect(exportTestDoubles.downloadBlob).toHaveBeenLastCalledWith(
      summary.zip,
      summary.zipFileName
    );

    await userEvent.click(screen.getByRole("button", { name: /关闭/u }));
    expect(storeState()).toMatchObject({ status: "idle", done: 0, total: 0, zipFileName: null });
    expect(storeFiles()).toHaveLength(2);
  });

  test("导出中表单锁死:disabled 透传给四个子组件,重置按钮禁用", async () => {
    renderExportPage();
    await addPreparedFiles(1);

    await clickExport();
    expect(pickerProps<ImagePickerProps>("image").disabled).toBe(true);
    expect(pickerProps<SizeTierPickerProps>("tier").disabled).toBe(true);
    expect(pickerProps<LogoPickerProps>("logo").disabled).toBe(true);
    expect(pickerProps<FramePreviewProps>("preview").disabled).toBe(true);
    expect(screen.getByRole("button", { name: /重置/u })).toBeDisabled();
  });

  test("重置清进度与图片但保留档位与 logo 偏好(用户不该再选一遍)", async () => {
    renderExportPage();
    await addPreparedFiles(2);
    act(() => useExportStore.setState({ sizeTier: "original", logoId: "juzi" }));

    await userEvent.click(screen.getByRole("button", { name: /重置/u }));
    expect(storeState()).toMatchObject({ status: "idle", done: 0, error: null });
    expect(storeFiles()).toHaveLength(0);
    expect(storeState().sizeTier).toBe("original");
    expect(storeState().logoId).toBe("juzi");
    expect(pickerProps<ImagePickerProps>("image").disabled).toBe(false);
  });
});

describe("logo 三态 → 渲染入参", () => {
  test("NO_LOGO:mark 与 blob 都空,预览与导出共用同一份事实", async () => {
    useExportStore.setState({ logoId: NO_LOGO_ID });
    renderExportPage();
    await addPreparedFiles(1);

    expect(previewProps()).toMatchObject({ logoMark: "", logoBlob: null });
    const run = await clickExport();
    expect(run.settings).toMatchObject({ logoMark: "", logoBlob: null });
    expect(exportTestDoubles.fetch).not.toHaveBeenCalled();
  });

  test("预设:mark 取清单字段,blob 走 assetUrl 拼出的同源地址", async () => {
    exportTestDoubles.catalog.logos = [...DEFAULT_LOGOS, makeLogoEntry("page-brand-a", "BRANDA")];
    useExportStore.setState({ logoId: "page-brand-a" });
    stubPresetFetch(true);
    renderExportPage();

    await waitFor(() => expect(previewProps().logoMark).toBe("BRANDA"));
    expect(exportTestDoubles.assetUrl).toHaveBeenCalledWith("assets/logos/page-brand-a.svg");
    expect(exportTestDoubles.fetch).toHaveBeenCalledWith("/assets/logos/page-brand-a.svg");
    expect(previewProps().logoBlob).toBeInstanceOf(Blob);
  });

  test("网络失败:预设图 404 只降级成文字块(mark 保住),页面不整页报错", async () => {
    exportTestDoubles.catalog.logos = [...DEFAULT_LOGOS, makeLogoEntry("page-brand-b", "BRANDB")];
    useExportStore.setState({ logoId: "page-brand-b" });
    stubPresetFetch(false);
    renderExportPage();

    await waitFor(() => expect(previewProps().logoMark).toBe("BRANDB"));
    expect(previewProps().logoBlob).toBeNull();
    expect(screen.getByRole("button", { name: EXPORT_BUTTON })).toBeEnabled();
  });

  test("网络失败:fetch 直接 reject 同样降级,不冒未捕获异常", async () => {
    exportTestDoubles.catalog.logos = [...DEFAULT_LOGOS, makeLogoEntry("page-brand-c", "BRANDC")];
    useExportStore.setState({ logoId: "page-brand-c" });
    exportTestDoubles.fetch.mockRejectedValue(new Error("network down"));
    renderExportPage();

    await waitFor(() => expect(previewProps().logoMark).toBe("BRANDC"));
    expect(previewProps().logoBlob).toBeNull();
  });

  test("预设图按 source 只取一次:来回切 logo 不重复请求(每次切换重取是白耗配额)", async () => {
    exportTestDoubles.catalog.logos = [...DEFAULT_LOGOS, makeLogoEntry("page-brand-d", "BRANDD")];
    useExportStore.setState({ logoId: "page-brand-d" });
    stubPresetFetch(true);
    renderExportPage();
    await waitFor(() => expect(previewProps().logoMark).toBe("BRANDD"));

    act(() => useExportStore.setState({ logoId: NO_LOGO_ID }));
    act(() => useExportStore.setState({ logoId: "page-brand-d" }));
    await waitFor(() => expect(previewProps().logoMark).toBe("BRANDD"));
    expect(exportTestDoubles.fetch).toHaveBeenCalledTimes(1);
  });

  test("自定义:mark 用文件主名、blob 就是用户选的那个 File", async () => {
    const file = new File(["png-bytes"], "brand-logo.png", { type: "image/png" });
    useExportStore.setState({ logoId: CUSTOM_LOGO_ID, customLogoFile: file });
    renderExportPage();

    await waitFor(() => expect(previewProps().logoMark).toBe("brand-logo"));
    expect(previewProps().logoBlob).toBe(file);
    expect(exportTestDoubles.fetch).not.toHaveBeenCalled();
  });

  test("零值:0 字节的自定义图不喂解码器(那会让整批全失败),按无图处理", async () => {
    const empty = new File([], "empty.png", { type: "image/png" });
    useExportStore.setState({ logoId: CUSTOM_LOGO_ID, customLogoFile: empty });
    renderExportPage();

    await waitFor(() => expect(previewProps().logoMark).toBe("empty"));
    expect(previewProps().logoBlob).toBeNull();
  });

  test("越界:选了自定义却没给文件(刷新后 File 不持久化)→ 本次导出退化为无 logo", async () => {
    useExportStore.setState({ logoId: CUSTOM_LOGO_ID, customLogoFile: null });
    renderExportPage();
    await addPreparedFiles(1);

    const run = await clickExport();
    expect(run.settings).toMatchObject({ logoMark: "", logoBlob: null });
    expect(storeState().status).toBe("exporting");
  });

  test("越界:清单里没有的预设 id 按无 logo 处理,不拿别人的 mark 冒充", async () => {
    useExportStore.setState({ logoId: "ghost-logo" });
    renderExportPage();
    await addPreparedFiles(1);

    expect(previewProps()).toMatchObject({ logoMark: "", logoBlob: null });
    expect(exportTestDoubles.fetch).not.toHaveBeenCalled();
  });
});

describe("栅格与移动端", () => {
  test("桌面两栏:左表单 16 放三件套、右预览 8", () => {
    const { container } = renderExportPage();
    const [formCol, previewCol] = layoutCols(container);

    expect(spanOf(formCol)).toBe("16");
    expect(spanOf(previewCol)).toBe("8");
    expect(pickerLabelsIn(formCol)).toEqual(["image", "tier", "logo"]);
    expect(pickerLabelsIn(previewCol)).toEqual(["preview"]);
    expect(container.querySelector(".export-layout--mobile")).toBeNull();
  });

  test("平板仍是两栏,只是表单让出 2 格给预览(14/10)", () => {
    exportTestDoubles.responsive.isTablet = true;
    const { container } = renderExportPage();
    const cols = layoutCols(container);
    const [formCol, previewCol] = cols;

    expect(cols).toHaveLength(2);
    expect(spanOf(formCol)).toBe("14");
    expect(spanOf(previewCol)).toBe("10");
    expect(container.querySelector(".export-layout--mobile")).toBeNull();
  });

  test("手机单列:表单占满 24 且带 --mobile 类,预览列仍排在表单列之后(JSX 顺序即视觉顺序)", () => {
    exportTestDoubles.responsive.isMobile = true;
    const { container } = renderExportPage();
    const cols = layoutCols(container);
    const [formCol, previewCol] = cols;

    expect(container.querySelector(".export-layout--mobile")).not.toBeNull();
    expect(cols).toHaveLength(2);
    expect(spanOf(formCol)).toBe("24");
    // 单列时预览必须占满 24:`24 - formSpan` 反算出的 span 0 会被 arco 的
    // `.arco-col-0{display:none}` 整块藏掉,所以 page.tsx 对移动端显式给满宽。
    expect(spanOf(previewCol)).toBe("24");
    expect(pickerLabelsIn(formCol.parentElement as HTMLElement)).toEqual([
      "image",
      "tier",
      "logo",
      "preview"
    ]);
  });

  test("断点切换后重渲染即改列宽(栅格由 use-responsive 单一口径驱动)", () => {
    const { container, rerender } = renderExportPage();
    expect(spanOf(layoutCols(container)[0])).toBe("16");

    exportTestDoubles.responsive.isTablet = true;
    rerender(<FrameExportPage />);
    expect(spanOf(layoutCols(container)[0])).toBe("14");
    expect(spanOf(layoutCols(container)[1])).toBe("10");
  });

  test("D19:移动端越过软提示张数只提示、不拦人,点导出照样起跑", async () => {
    exportTestDoubles.responsive.isMobile = true;
    renderExportPage();
    await addPreparedFiles(MOBILE_SOFT_LIMIT + 1);

    expect(screen.getByText("移动端批量导出提示")).toBeInTheDocument();
    expect(screen.getByText(/也可以继续导出/u)).toBeInTheDocument();
    const run = await clickExport();
    expect(Array.from(run.files)).toHaveLength(MOBILE_SOFT_LIMIT + 1);
    expect(storeState().status).toBe("exporting");
  });

  test("桌面同张数不提示(那条内存预算讲的是移动端)", async () => {
    renderExportPage();
    await addPreparedFiles(MOBILE_SOFT_LIMIT + 1);

    expect(screen.queryByText("移动端批量导出提示")).not.toBeInTheDocument();
  });

  test("预览拿首图的 EXIF 文案与 File 源,不给它第二份事实", async () => {
    renderExportPage();
    await addPreparedFiles(2);

    const props = previewProps();
    expect(props.source).toBe(storeFiles()[0].file);
    expect(props.fields).toEqual({ brand: "SONY" });
    expect(exportTestDoubles.frameFieldsFromExif).toHaveBeenCalled();
  });
});
