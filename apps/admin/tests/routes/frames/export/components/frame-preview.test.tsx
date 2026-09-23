import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 相框实时预览用例(阶段 11)。
 *
 * **必须打桩 `preview-render`**:jsdom 没有 canvas、没有 `createImageBitmap`、也没有
 * `OffscreenCanvas`(apps/admin/AGENTS.md 第 8 节),真渲染一行都跑不起来。
 * 本组件的职责恰恰是「什么时候画、画完怎么显示、画砸了怎么说」,所以打桩点选在渲染模块边界,
 * 只验调度与呈现。1200px 长边与缩放算术本身在 tests/utils/frame/preview-render.test.ts 里钉。
 *
 * `useObjectUrl` 不打桩(URL 生命周期 D22 就是要验的对象),只把 `URL.createObjectURL/revokeObjectURL`
 * 换成可断言的替身。
 *
 * 六类边界对照:
 * - 空值:`source` 为 null(还没选图)→ 空态且一次都不画;产物 URL 生成失败 → 退回骨架而不是空白;
 * - 零值:`fields` 为空对象(用户什么都没填)照样出图,组件不替绘制端判「参数不全」;
 * - 越界:参数在防抖窗口内被连点 N 次 → 只画最后一张;`source` 中途清空 → 在途结果作废;
 * - 权限缺失:不适用。本站匿名公开、无鉴权(apps/admin/AGENTS.md 第 3 节),本层也不发请求;
 * - 上游失败:`renderPreview` 抛中文业务错(样式未注册/图片为空/解不了)→ 可读 Alert + 重试;
 *   抛非 Error、抛空 message 都有兜底文案,不许出现「undefined」;
 * - 非法状态迁移:`disabled`(导出进行中)不排画、不改画面;内容相同的 `fields` 新对象不重画。
 */

const { renderPreviewMock } = vi.hoisted(() => ({ renderPreviewMock: vi.fn() }));

vi.mock("../../../../../src/utils/frame/preview-render", () => ({
  renderPreview: renderPreviewMock
}));

import FramePreview, {
  type FramePreviewProps
} from "../../../../../src/routes/frames/[styleId]/export/components/frame-preview";
import type { FrameFields } from "../../../../../src/utils/frame/types";

/** 组件内的防抖窗口(未导出:它是实现细节,这里按同一口径推进时钟)。 */
const DEBOUNCE_MS = 300;

const makeFile = (name = "a.jpg"): File =>
  new File([new Uint8Array(128)], name, { type: "image/jpeg" });

const makeBlob = (tag: string): Blob => new Blob([tag], { type: "image/jpeg" });

const FIELDS: FrameFields = { brand: "Acme", exposure: "35mm  f/1.8  1/125  ISO100" };

let source: File;
let logoBlob: Blob;

function makeProps(overrides: Partial<FramePreviewProps> = {}): FramePreviewProps {
  return {
    styleId: "classic-dark",
    source,
    logoMark: "ACME",
    logoBlob,
    fields: FIELDS,
    disabled: false,
    ...overrides
  };
}

const created: string[] = [];
const revoked: string[] = [];

function setUpObjectUrlSpy(): void {
  created.length = 0;
  revoked.length = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob | MediaSource) => {
    const url = `blob:preview-${String(created.length + 1)}`;
    created.push(url);
    void blob;
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
    revoked.push(url);
  });
}

/** 推进到防抖窗口之后并冲刷微任务:一次完整「排画 → 开跑」的节拍。 */
async function runPastDebounce(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(DEBOUNCE_MS + 50);
  });
}

/** 只冲刷微任务(不动时钟):让已 resolve 的 renderPreview 走到 setState。 */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

const imageSrc = (container: HTMLElement): string | null =>
  container.querySelector("img")?.getAttribute("src") ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  setUpObjectUrlSpy();
  source = makeFile();
  logoBlob = makeBlob("logo");
  // 每次成功都给一个**新** Blob:同一份 Blob 会让 useObjectUrl 认定引用没变,
  // 于是「换图换新 URL」那条测的就不是生命周期而是 mock 的形状了。
  renderPreviewMock.mockImplementation(async () => makeBlob("preview"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("空态与出图", () => {
  it("空值:没选图时是空态,一次都不画,也不生成 URL", async () => {
    const { container } = render(<FramePreview {...makeProps({ source: null })} />);
    await runPastDebounce();

    expect(screen.getByText("选择照片后即可看到相框效果")).toBeInTheDocument();
    expect(renderPreviewMock).not.toHaveBeenCalled();
    expect(created).toEqual([]);
    expect(container.querySelector("img")).toBeNull();
  });

  it("选完图过完防抖窗口才画一次,请求形状就是 props(渲染策略不在组件里)", async () => {
    render(<FramePreview {...makeProps()} />);

    await runPastDebounce();
    expect(renderPreviewMock).toHaveBeenCalledTimes(1);
    expect(renderPreviewMock.mock.calls[0][0]).toEqual({
      source,
      styleId: "classic-dark",
      logoMark: "ACME",
      logoBlob,
      fields: FIELDS
    });
  });

  it("窗口内连改参数只画最后一张(选图器多选、连续换 logo 都会连击)", async () => {
    const { rerender } = render(<FramePreview {...makeProps()} />);

    rerender(<FramePreview {...makeProps({ fields: { brand: "B" } })} />);
    rerender(<FramePreview {...makeProps({ logoMark: "JUZI" })} />);
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS + 50);
    });

    expect(renderPreviewMock).toHaveBeenCalledTimes(1);
    expect(renderPreviewMock.mock.calls[0][0]).toMatchObject({ logoMark: "JUZI" });
  });

  it("产物落地后显示 object URL,展示期间一次 revoke 都没有(D22 第③条)", async () => {
    const { container } = render(<FramePreview {...makeProps()} />);
    await runPastDebounce();
    await flushMicrotasks();

    expect(imageSrc(container)).toBe("blob:preview-1");
    expect(revoked).toEqual([]);
  });

  it("画的过程中给骨架/转圈,不出空白块", async () => {
    let release = (): void => {};
    renderPreviewMock.mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          release = () => resolve(makeBlob("later"));
        })
    );
    const { container } = render(<FramePreview {...makeProps()} />);

    await runPastDebounce();
    expect(container.querySelector(".frame-preview-skeleton")).not.toBeNull();
    expect(container.querySelector(".arco-spin")).not.toBeNull();

    release();
    await flushMicrotasks();
    expect(container.querySelector(".frame-preview-skeleton")).toBeNull();
    expect(imageSrc(container)).toBe("blob:preview-1");
  });

  it("零值:fields 是空对象也照画——判「参数不全」是绘制端的事", async () => {
    render(<FramePreview {...makeProps({ fields: {} })} />);
    await runPastDebounce();

    expect(renderPreviewMock).toHaveBeenCalledTimes(1);
    expect(renderPreviewMock.mock.calls[0][0]).toMatchObject({ fields: {} });
  });
});

describe("竞态与作废", () => {
  it("慢的旧请求后到也不许盖掉新画面(否则画面与选择器错位)", async () => {
    const first = makeDeferred();
    const second = makeDeferred();
    renderPreviewMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { container, rerender } = render(<FramePreview {...makeProps()} />);
    await runPastDebounce();

    rerender(<FramePreview {...makeProps({ fields: { brand: "新参数" } })} />);
    await runPastDebounce();
    expect(renderPreviewMock).toHaveBeenCalledTimes(2);

    // 新参数先回来、旧参数后回来:真实网络/解码里完全可能。
    second.resolve(makeBlob("new"));
    await flushMicrotasks();
    expect(imageSrc(container)).toBe("blob:preview-1");

    first.resolve(makeBlob("old"));
    await flushMicrotasks();
    expect(imageSrc(container)).toBe("blob:preview-1");
    // 过期产物连 URL 都不该生成,更不该被展示。
    expect(created).toEqual(["blob:preview-1"]);
  });

  it("越界:在途时把图清空 → 画面立刻回空态,迟到的结果被丢弃且不生成 URL", async () => {
    const pending = makeDeferred();
    renderPreviewMock.mockImplementationOnce(() => pending.promise);

    const { container, rerender } = render(<FramePreview {...makeProps()} />);
    await runPastDebounce();

    rerender(<FramePreview {...makeProps({ source: null })} />);
    await flushMicrotasks();
    expect(screen.getByText("选择照片后即可看到相框效果")).toBeInTheDocument();

    pending.resolve(makeBlob("late"));
    await flushMicrotasks();
    expect(container.querySelector("img")).toBeNull();
    expect(created).toEqual([]);
  });

  it("内容相同、引用不同的 fields 不重画(父组件每次渲染都新建对象)", async () => {
    const { rerender } = render(<FramePreview {...makeProps()} />);
    await runPastDebounce();

    rerender(<FramePreview {...makeProps({ fields: { ...FIELDS } })} />);
    rerender(<FramePreview {...makeProps({ fields: { ...FIELDS } })} />);
    await runPastDebounce();

    expect(renderPreviewMock).toHaveBeenCalledTimes(1);
  });
});

describe("失败呈现", () => {
  it("上游失败:中文业务错原样露出,并给可点的重试", async () => {
    renderPreviewMock.mockRejectedValueOnce(new Error("这张图片内容为空, 无法预览。"));
    const { container } = render(<FramePreview {...makeProps()} />);
    await runPastDebounce();
    await flushMicrotasks();

    expect(container.querySelector(".frame-preview-error")).not.toBeNull();
    expect(screen.getByText("预览生成失败")).toBeInTheDocument();
    expect(screen.getByText("这张图片内容为空, 无法预览。")).toBeInTheDocument();
    // 失败态绝不是一张空白图。
    expect(container.querySelector("img")).toBeNull();

    renderPreviewMock.mockResolvedValueOnce(makeBlob("retry"));
    fireEvent.click(screen.getByRole("button", { name: /重试/u }));
    await flushMicrotasks();

    expect(renderPreviewMock).toHaveBeenCalledTimes(2);
    expect(imageSrc(container)).toBe("blob:preview-1");
  });

  it("重试按钮不等防抖:它必须立刻重画一次(用户点一下还要等 300ms 是白等)", async () => {
    renderPreviewMock.mockRejectedValueOnce(new Error("浏览器解不了这张图。"));
    render(<FramePreview {...makeProps()} />);
    await runPastDebounce();
    await flushMicrotasks();

    const before = renderPreviewMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /重试/u }));
    expect(renderPreviewMock).toHaveBeenCalledTimes(before + 1);
    // 重试这一发也是异步的:不等它落地就退出测试,React 会在 act 之外 setState。
    await flushMicrotasks();
  });

  it("越界:抛非 Error 值、抛空 message 都落到兜底文案,不许显示 undefined 或空串", async () => {
    renderPreviewMock.mockRejectedValueOnce("boom");
    const { rerender } = render(<FramePreview {...makeProps()} />);
    await runPastDebounce();
    await flushMicrotasks();

    expect(screen.getByText("预览生成失败: 未知原因。")).toBeInTheDocument();

    rerender(<FramePreview {...makeProps({ styleId: "other" })} />);
    renderPreviewMock.mockRejectedValueOnce(new Error(""));
    await runPastDebounce();
    await flushMicrotasks();
    expect(screen.getAllByText("预览生成失败: 未知原因。").length).toBeGreaterThan(0);
  });

  it("失败后换参数重画成功,错误条自己消失、旧错误不残留", async () => {
    renderPreviewMock.mockRejectedValueOnce(new Error("相框样式「x」未在注册表登记, 无法预览。"));
    const { container, rerender } = render(<FramePreview {...makeProps()} />);
    await runPastDebounce();
    await flushMicrotasks();
    expect(screen.getByText(/未在注册表登记/u)).toBeInTheDocument();

    rerender(<FramePreview {...makeProps({ fields: { brand: "B" } })} />);
    await runPastDebounce();
    await flushMicrotasks();

    expect(container.querySelector(".frame-preview-error")).toBeNull();
    expect(imageSrc(container)).toBe("blob:preview-1");
  });
});

describe("URL 生命周期与导出中禁用", () => {
  it("换一张图:旧产物的 URL 被回收,新产物用新 URL", async () => {
    const { container, rerender } = render(<FramePreview {...makeProps()} />);
    await runPastDebounce();
    await flushMicrotasks();
    expect(imageSrc(container)).toBe("blob:preview-1");

    const next = makeFile("b.jpg");
    rerender(<FramePreview {...makeProps({ source: next })} />);
    await runPastDebounce();
    await flushMicrotasks();

    expect(imageSrc(container)).toBe("blob:preview-2");
    expect(revoked).toEqual(["blob:preview-1"]);
  });

  it("卸载时回收在用的那条 URL", async () => {
    const { unmount } = render(<FramePreview {...makeProps()} />);
    await runPastDebounce();
    await flushMicrotasks();

    unmount();
    expect(revoked).toEqual(["blob:preview-1"]);
  });

  it("非法状态迁移:disabled(导出进行中)时不排画、不改画面", async () => {
    const { container } = render(<FramePreview {...makeProps({ disabled: true })} />);
    await runPastDebounce();

    expect(renderPreviewMock).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
  });

  it("非法状态迁移:已经画好的图在导出中保持不动,参数变了也不重画", async () => {
    const props = makeProps();
    const { container, rerender } = render(<FramePreview {...props} />);
    await runPastDebounce();
    await flushMicrotasks();
    expect(imageSrc(container)).toBe("blob:preview-1");

    rerender(
      <FramePreview {...makeProps({ disabled: true, fields: { brand: "导出中改的参数" } })} />
    );
    await runPastDebounce();

    expect(renderPreviewMock).toHaveBeenCalledTimes(1);
    expect(imageSrc(container)).toBe("blob:preview-1");
    expect(revoked).toEqual([]);
  });

  it("空值:URL 生成失败(隐私模式/配额)时退回骨架,不抛错也不给坏图", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("quota");
    });
    const { container } = render(<FramePreview {...makeProps()} />);
    await runPastDebounce();
    await flushMicrotasks();

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".frame-preview-skeleton")).not.toBeNull();
    expect(container.querySelector(".frame-preview-error")).toBeNull();
  });

  it("静态化纪律:预览链路不发任何请求", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<FramePreview {...makeProps()} />);
    await runPastDebounce();
    await flushMicrotasks();

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

interface Deferred {
  promise: Promise<Blob>;
  resolve: (blob: Blob) => void;
}

function makeDeferred(): Deferred {
  let resolve: (blob: Blob) => void = () => undefined;
  const promise = new Promise<Blob>((inner) => {
    resolve = inner;
  });
  return { promise, resolve };
}
