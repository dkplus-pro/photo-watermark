import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExportFileEntry } from "../../../../../src/store/export";

/**
 * 照片选择器用例(阶段 11)。
 *
 * `useObjectUrl` 不打桩——它就是要验的那条生命周期(谁创建谁释放),只把它的模块边界
 * `URL.createObjectURL/revokeObjectURL` 换成可断言的替身(apps/admin/AGENTS.md 第 8 节列的
 * 合法打桩点)。 arco `Upload` 也不打桩:本组件对它的用法(只当取文件触发器、不自绘列表)
 * 一旦脱离真实实现就验不出来。
 *
 * 六类边界对照:空值(files 为空、object URL 生成失败)、零值(源图尺寸 0 表示「未探测」,
 * 不许拼成「0×0」)、越界(张数越过 softLimit、阈值为 0/负数/NaN)、网络失败(选图不得发请求,
 * 本 app 无服务端)、非法状态迁移(disabled 期间点删除/拖入文件都不许改列表);
 * 权限缺失不适用:本站匿名公开、无鉴权(apps/admin/AGENTS.md 第 3 节)。
 */

const responsiveMock = vi.hoisted(() => ({ isMobile: false }));

vi.mock("../../../../../src/hooks/use-responsive", () => ({
  useIsMobile: () => responsiveMock.isMobile,
  useIsTablet: () => false
}));

import ImagePicker, {
  type ImagePickerProps
} from "../../../../../src/routes/frames/[styleId]/export/components/image-picker";

const makeFile = (name: string, size = 1024, lastModified = 1_700_000_000_000): File =>
  new File([new Uint8Array(size)], name, { type: "image/jpeg", lastModified });

function makeEntry(index: number, overrides: Partial<ExportFileEntry> = {}): ExportFileEntry {
  const file = makeFile(`photo-${String(index)}.jpg`);
  return {
    id: `entry-${String(index)}`,
    file,
    baseName: `photo-${String(index)}`,
    size: file.size,
    exif: null,
    exifReadAt: null,
    width: 0,
    height: 0,
    thumb: null,
    ...overrides
  };
}

function makeEntries(count: number): ExportFileEntry[] {
  return Array.from({ length: count }, (_unused, index) => makeEntry(index + 1));
}

interface UrlScaffold {
  readonly created: string[];
  readonly revoked: string[];
}

let urlScaffold: UrlScaffold;
let failNextCreate: boolean;

function setUpObjectUrlSpy(): void {
  urlScaffold = { created: [], revoked: [] };
  failNextCreate = false;
  vi.spyOn(URL, "createObjectURL").mockImplementation((source: Blob | MediaSource) => {
    if (failNextCreate) throw new Error("quota exhausted");
    const url = `blob:mock-${String(urlScaffold.created.length + 1)}`;
    urlScaffold.created.push(url);
    void source;
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
    urlScaffold.revoked.push(url);
  });
}

const fetchSpy = vi.fn();

const handlers = vi.hoisted(() => ({
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  onClear: vi.fn()
}));

function renderPicker(overrides: Partial<ImagePickerProps> = {}) {
  const props: ImagePickerProps = {
    files: makeEntries(2),
    disabled: false,
    softLimit: 20,
    onAdd: handlers.onAdd,
    onRemove: handlers.onRemove,
    onClear: handlers.onClear,
    ...overrides
  };
  return render(<ImagePicker {...props} />);
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error("没有找到 <input type=file>:选图入口没了");
  return input as HTMLInputElement;
}

beforeEach(() => {
  responsiveMock.isMobile = false;
  vi.clearAllMocks();
  setUpObjectUrlSpy();
  // 静态化纪律:本 app 没有服务端,任何一次选图都不该产生请求。
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("列表渲染", () => {
  it("空值:一张没选时给空态提示,不渲染条目,清空按钮禁用", () => {
    const { container } = renderPicker({ files: [] });

    expect(container.querySelectorAll(".image-picker-item")).toHaveLength(0);
    expect(screen.getByText(/还没有选择照片/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /清空/u })).toBeDisabled();
    expect(urlScaffold.created).toHaveLength(0);
  });

  it("两张图渲染两行,行内是主名与体积,头部给出合计", () => {
    const { container } = renderPicker();

    expect(container.querySelectorAll(".image-picker-item")).toHaveLength(2);
    expect(screen.getByText("photo-1")).toBeInTheDocument();
    // 1024 字节按 formatByteSize 口径是 1.0 KB,两行合计 2.0 KB。
    expect(screen.getAllByText("1.0 KB")).toHaveLength(2);
    expect(screen.getByText(/已选 2 张 · 2\.0 KB/u)).toBeInTheDocument();
  });

  it("探测出的源图尺寸跟在体积后,零值(未探测)不拼成 0×0", () => {
    const { container } = renderPicker({
      files: [makeEntry(1, { width: 6000, height: 4000 }), makeEntry(2)]
    });
    const metas = Array.from(container.querySelectorAll(".image-picker-item-size")).map(
      (node) => node.textContent
    );

    expect(metas[0]).toBe("1.0 KB · 6000×4000");
    expect(metas[1]).toBe("1.0 KB");
  });

  it("每张图各占一个 object URL,且赋好 src 之前一次 revoke 都没有(D22 第③条)", () => {
    const { container } = renderPicker();
    const srcs = Array.from(container.querySelectorAll("img")).map(
      (node) => node.getAttribute("src") ?? ""
    );

    expect(srcs).toEqual(["blob:mock-1", "blob:mock-2"]);
    expect(urlScaffold.revoked).toEqual([]);
  });

  it("有小缩略图时 URL 只为缩略图而建(不为一张 ~100px 的缩略位解码整幅原图)", () => {
    const thumb = new Blob(["thumb-bytes"], { type: "image/jpeg" });
    const { container } = renderPicker({
      files: [makeEntry(1, { thumb })]
    });
    const srcs = Array.from(container.querySelectorAll("img")).map(
      (node) => node.getAttribute("src") ?? ""
    );

    // 只建了缩略图那一条 URL;原图的 URL 不创建,也不产生多余的 revoke。
    expect(srcs).toEqual(["blob:mock-1"]);
    expect(urlScaffold.created).toEqual(["blob:mock-1"]);
    expect(urlScaffold.revoked).toEqual([]);
  });

  it("URL 生成失败只丢这一张的缩略,这一行仍然可删除、仍参与导出", () => {
    failNextCreate = true;
    const { container } = renderPicker({ files: [makeEntry(1)] });

    expect(container.querySelector(".image-picker-item-thumb")).toBeNull();
    expect(screen.getByText("无法显示")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /移除 photo-1/u })).toBeEnabled();
  });
});

describe("选图与删除回调", () => {
  it("原生 input 带 accept=image/* 与 multiple(iOS 上这是唯一可靠入口)", () => {
    const { container } = renderPicker();
    const input = fileInput(container);

    expect(input.getAttribute("accept")).toBe("image/*");
    expect(input.multiple).toBe(true);
  });

  it("选中两个文件即两次 onAdd,各带一个 File;不发任何请求(autoUpload=false 的实证)", async () => {
    const { container } = renderPicker();
    const first = makeFile("a.jpg");
    const second = makeFile("b.jpg");

    fireEvent.change(fileInput(container), { target: { files: [first, second] } });

    // arco 的默认 beforeUpload 返回 Promise,onChange 落在微任务里,不能同步断言。
    await waitFor(() => expect(handlers.onAdd).toHaveBeenCalledTimes(2));
    expect(handlers.onAdd.mock.calls.map((call) => (call[0] as File[])[0].name)).toEqual([
      "a.jpg",
      "b.jpg"
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("点缩略图上的删除钮只移除那一张的 id", () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: /移除 photo-2/u }));
    expect(handlers.onRemove).toHaveBeenCalledTimes(1);
    expect(handlers.onRemove).toHaveBeenCalledWith("entry-2");
  });

  it("点清空把整表交给上层,组件自己不删条目", () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: /清空/u }));
    expect(handlers.onClear).toHaveBeenCalledTimes(1);
    expect(handlers.onRemove).not.toHaveBeenCalled();
  });

  it("换一批文件时上一张的 URL 被回收、留下的那张不动", () => {
    // 留下的那张必须复用同一个 entry / File 引用,否则测的就不是「引用没变」而是「全新挂载」。
    const dropped = makeEntry(1);
    const kept = makeEntry(2);
    const { rerender, container } = renderPicker({ files: [dropped, kept] });
    expect(urlScaffold.revoked).toEqual([]);

    rerender(
      <ImagePicker
        files={[makeEntry(9), kept]}
        disabled={false}
        softLimit={20}
        onAdd={handlers.onAdd}
        onRemove={handlers.onRemove}
        onClear={handlers.onClear}
      />
    );

    // entry-1 被换掉 → 只有它那条 URL 被释放;entry-2 的引用没变,URL 留着继续显示。
    expect(urlScaffold.revoked).toEqual(["blob:mock-1"]);
    const srcs = Array.from(container.querySelectorAll("img")).map(
      (node) => node.getAttribute("src") ?? ""
    );
    expect(srcs).toEqual(["blob:mock-3", "blob:mock-2"]);
  });

  it("卸载时把在用的每条 URL 都回收(一次挂几十张图不留泄漏)", () => {
    const { unmount } = renderPicker();

    unmount();
    expect(urlScaffold.revoked.sort()).toEqual(["blob:mock-1", "blob:mock-2"]);
  });
});

describe("拖拽与端型差异", () => {
  it("桌面渲染 arco 拖拽区,拖入文件即等价于选图", async () => {
    const { container } = renderPicker();
    const dropZone = container.querySelector(".arco-upload-trigger-drag");

    expect(dropZone).not.toBeNull();
    fireEvent.drop(dropZone as HTMLElement, {
      // arco 的 drop 读 dataTransfer.files 与 items(items 用来剔掉目录),两者都得给。
      dataTransfer: { files: [makeFile("dropped.jpg")], items: [] }
    });
    // 与点选同一条异步链路(先建 UploadItem 再回调),同步断言会早一拍。
    await waitFor(() => expect(handlers.onAdd).toHaveBeenCalledTimes(1));
    expect(handlers.onAdd.mock.calls[0][0][0].name).toBe("dropped.jpg");
  });

  it("移动端换成真正的按钮与 44px 触摸目标,不再出现「拖拽」入口", async () => {
    responsiveMock.isMobile = true;
    const { container } = renderPicker();

    expect(container.querySelector(".arco-upload-trigger-drag")).toBeNull();
    expect(screen.getByRole("button", { name: /选择照片/u })).toBeInTheDocument();
    expect(container.querySelector(".image-picker-trigger")).not.toBeNull();
    // 入口仍然只是那个原生 file input,点击不该发请求。
    await userEvent.click(screen.getByRole("button", { name: /选择照片/u }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("空态文案跟着端型走:触屏上「拖进来」根本不成立", () => {
    responsiveMock.isMobile = true;
    renderPicker({ files: [] });
    expect(screen.getByText(/点上方「选择照片」/u)).toBeInTheDocument();
  });

  it("移动端空态之外,桌面空态讲的是拖拽", () => {
    renderPicker({ files: [] });
    expect(screen.getByText(/把图片直接拖进来/u)).toBeInTheDocument();
  });
});

describe("D19 软提示", () => {
  it("移动端张数越过阈值才提示,提示里带上阈值数字且不阻断操作", () => {
    responsiveMock.isMobile = true;
    const { container, rerender } = renderPicker({ files: makeEntries(20) });

    expect(container.querySelector(".arco-alert")).toBeNull();

    rerender(
      <ImagePicker
        files={makeEntries(21)}
        disabled={false}
        softLimit={20}
        onAdd={handlers.onAdd}
        onRemove={handlers.onRemove}
        onClear={handlers.onClear}
      />
    );
    expect(screen.getByText(/一次选择 20 张以上会较慢且占内存/u)).toBeInTheDocument();
    // 非阻断:提示出现后删除与清空依旧可用。
    expect(container.querySelector(".arco-alert-error")).toBeNull();
    expect(screen.getByRole("button", { name: /清空/u })).toBeEnabled();
  });

  it("桌面同样张数不提示(预算是移动的 4 倍,D19 讲的是移动端)", () => {
    const { container } = renderPicker({ files: makeEntries(21) });

    expect(container.querySelector(".arco-alert")).toBeNull();
  });

  it("越界:阈值为 0、负数、NaN、Infinity 时一律不提示", () => {
    responsiveMock.isMobile = true;
    for (const softLimit of [0, -20, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { container, unmount } = renderPicker({ files: makeEntries(3), softLimit });
      expect(container.querySelector(".arco-alert")).toBeNull();
      unmount();
    }
  });
});

describe("导出进行中禁用", () => {
  it("disabled 时三个动作全部禁用,点删除/清空不回调", async () => {
    const { container } = renderPicker({ disabled: true });

    expect(screen.getByRole("button", { name: /清空/u })).toBeDisabled();
    expect(screen.getByRole("button", { name: /移除 photo-1/u })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /移除 photo-1/u }), {
      // arco 的禁用按钮仍吞掉事件,这里连点击事件都拿不到回调即为通过。
      pointerEventsCheck: 0
    });
    await userEvent.click(screen.getByRole("button", { name: /清空/u }), { pointerEventsCheck: 0 });
    expect(handlers.onRemove).not.toHaveBeenCalled();
    expect(handlers.onClear).not.toHaveBeenCalled();
    expect(container.querySelector(".arco-btn-disabled")).not.toBeNull();
  });

  it("disabled 时拖入文件不改列表(流水线在跑,列表中途变会让批次与进度对不上)", () => {
    const { container } = renderPicker({ disabled: true });
    const dropZone = container.querySelector(".arco-upload-trigger-drag") as HTMLElement;

    fireEvent.drop(dropZone, { dataTransfer: { files: [makeFile("late.jpg")] } });
    expect(handlers.onAdd).not.toHaveBeenCalled();
  });
});
