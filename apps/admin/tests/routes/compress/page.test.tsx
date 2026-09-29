import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * 压缩图片页用例。mock 只打在模块边界:
 * - compress-batch:批处理引擎(替身按真实契约走 handlers,条目直接压成 done);
 * - image-size-probe / thumbnail:准备阶段的探测(尺寸未知 → 列表只显体积);
 * - webp-support:格式决策探测;
 * - utils/download:下载收口(断言单张与 zip 两次下载的文件名与 MIME);
 * - @modern-js/runtime/router:PageContainer 的面包屑。
 * store 是真实实现(页面用例不 mock store;守卫细节在 store/compress.test.ts)。
 */

const batchMock = vi.hoisted(() => ({ run: vi.fn() }));
const downloadMock = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
const probeMock = vi.hoisted(() => ({ probeSourceSize: vi.fn() }));
const thumbnailMock = vi.hoisted(() => ({ makePhotoThumbnail: vi.fn() }));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/utils/compress/compress-batch", () => ({
  runCompressBatch: batchMock.run,
  createCompressCancelToken: () => ({ cancelled: false, cancel: () => undefined })
}));
vi.mock("../../../src/utils/download", () => ({ downloadBlob: downloadMock.downloadBlob }));
vi.mock("../../../src/utils/frame/image-size-probe", () => ({
  probeSourceSize: probeMock.probeSourceSize
}));
vi.mock("../../../src/utils/frame/thumbnail", () => ({
  makePhotoThumbnail: thumbnailMock.makePhotoThumbnail
}));
vi.mock("@modern-js/runtime/router", () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: "/compress" })
}));

import CompressPage from "../../../src/routes/compress/page";
import { useCompressStore } from "../../../src/store/compress";
import type {
  CompressBatchItem,
  CompressProgressHandlers
} from "../../../src/utils/compress/compress-batch";

const imageFile = (name: string): File =>
  new File([new Uint8Array(10)], name, { type: "image/jpeg", lastModified: 1_000 });

beforeEach(() => {
  localStorage.clear();
  useCompressStore.setState({ files: [], mode: "smart", quality: 80 });
  vi.clearAllMocks();
  probeMock.probeSourceSize.mockResolvedValue(null);
  thumbnailMock.makePhotoThumbnail.mockResolvedValue(null);
  // 替身按真实契约走 handlers:逐张 started → done,条目落 done 状态(与真引擎一致)。
  batchMock.run.mockImplementation(
    async (
      items: readonly CompressBatchItem[],
      _settings: unknown,
      handlers?: CompressProgressHandlers
    ) => {
      for (const item of items) {
        handlers?.onItemStarted?.(item.id);
        const base = item.file.name.replace(/\.[^.]+$/u, "");
        handlers?.onItemDone?.({
          id: item.id,
          blob: new Blob(["abcd"]),
          size: 4,
          width: 4,
          height: 4,
          mime: "image/webp",
          fileName: `${base}.webp`
        });
      }
      return { succeeded: items.length, failed: 0, cancelled: false };
    }
  );
});

afterEach(() => {
  cleanup();
});

describe("空列表(hero 入口)", () => {
  test("渲染大拖拽区,不渲染设置卡/列表/汇总栏", () => {
    render(<CompressPage />);
    expect(screen.getByText("拖放图片到此处,或点击选择")).toBeTruthy();
    expect(screen.queryByText("压缩设置")).toBeNull();
    expect(screen.queryByText("打包下载 ZIP")).toBeNull();
  });
});

describe("入队与压缩结果", () => {
  test("添加即自动整批派发,列表显示体积变化与节省标签", async () => {
    render(<CompressPage />);
    useCompressStore.getState().addFiles([imageFile("a.jpg")]);
    await waitFor(() => expect(screen.getByText("已完成 1/1 张")).toBeTruthy());
    expect(batchMock.run).toHaveBeenCalledTimes(1);
    const items = batchMock.run.mock.calls[0]?.[0] as readonly CompressBatchItem[];
    expect(items.map((item) => item.file.name)).toEqual(["a.jpg"]);
    expect(screen.getByText("10 B → 4 B")).toBeTruthy();
    expect(screen.getByText("-60%")).toBeTruthy();
    // 设置卡在列表非空时可见,当前质量值如实显示
    expect(screen.getByText("压缩设置")).toBeTruthy();
    expect(screen.getAllByText("80%").length).toBeGreaterThan(0);
  });

  test("单张下载按钮把产物交给下载收口", async () => {
    const user = userEvent.setup();
    render(<CompressPage />);
    useCompressStore.getState().addFiles([imageFile("a.jpg")]);
    await waitFor(() => expect(screen.getByRole("button", { name: "下载 a" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "下载 a" }));
    expect(downloadMock.downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, fileName] = downloadMock.downloadBlob.mock.calls[0] ?? [];
    expect((blob as Blob).type).toBe("");
    expect(fileName).toBe("a.webp");
  });

  test("打包下载 ZIP:产物按 image-compress- 日期命名,application/zip 类型", async () => {
    const user = userEvent.setup();
    render(<CompressPage />);
    useCompressStore.getState().addFiles([imageFile("a.jpg"), imageFile("b.jpg")]);
    await waitFor(() => expect(screen.getByText("已完成 2/2 张")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: /打包下载 ZIP/ }));
    await waitFor(() => expect(downloadMock.downloadBlob).toHaveBeenCalledTimes(1));
    const [blob, fileName] = downloadMock.downloadBlob.mock.calls[0] ?? [];
    expect((blob as Blob).type).toBe("application/zip");
    expect(fileName as string).toMatch(/^image-compress-\d{4}-\d{2}-\d{2}\.zip$/u);
  });

  test("移除单条与清空全部", async () => {
    const user = userEvent.setup();
    render(<CompressPage />);
    useCompressStore.getState().addFiles([imageFile("a.jpg"), imageFile("b.jpg")]);
    await waitFor(() => expect(screen.getByText("已完成 2/2 张")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "移除 a" }));
    await waitFor(() => expect(screen.getByText("已完成 1/1 张")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: /清空/ }));
    await waitFor(() => expect(screen.getByText("拖放图片到此处,或点击选择")).toBeTruthy());
    expect(screen.queryByText("打包下载 ZIP")).toBeNull();
  });
});

describe("失败呈现", () => {
  test("失败条目展示失败标签与原因,全部失败时打包按钮禁用", async () => {
    batchMock.run.mockImplementation(
      async (
        items: readonly CompressBatchItem[],
        _settings: unknown,
        handlers?: CompressProgressHandlers
      ) => {
        for (const item of items) {
          handlers?.onItemStarted?.(item.id);
          handlers?.onItemFailed?.({
            id: item.id,
            message: "无法解码该图片: 浏览器可能不支持此编码"
          });
        }
        return { succeeded: 0, failed: items.length, cancelled: false };
      }
    );
    render(<CompressPage />);
    useCompressStore.getState().addFiles([imageFile("bad.heic")]);
    await waitFor(() => expect(screen.getByText("已完成 0/1 张 · 1 张失败")).toBeTruthy());
    expect(screen.getByText("失败")).toBeTruthy();
    expect(screen.getByText(/浏览器可能不支持此编码/)).toBeTruthy();
    const zipButton = screen.getByRole("button", { name: /打包下载 ZIP/ }) as HTMLButtonElement;
    expect(zipButton.disabled).toBe(true);
  });
});

describe("设置卡", () => {
  test("切换输出格式写回 store 并反映选中态", async () => {
    const user = userEvent.setup();
    render(<CompressPage />);
    useCompressStore.getState().addFiles([imageFile("a.jpg")]);
    await waitFor(() => expect(screen.getByText("压缩设置")).toBeTruthy());
    await user.click(screen.getByText("转 WebP"));
    expect(useCompressStore.getState().mode).toBe("webp");
  });
});
