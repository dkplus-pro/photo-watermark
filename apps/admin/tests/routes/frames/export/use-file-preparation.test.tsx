// 文件准备阶段用例(阶段 13,`src/routes/frames/[styleId]/export/use-file-preparation.ts`)。
// 六类边界落点:空值(files 为空数组不得动状态机)、零值(尺寸探不出来时 width 保持 0 这个合法终态)、
// 越界(重复渲染不得重复探测)、权限缺失不适用(本站无鉴权,apps/admin/AGENTS.md 第 3 节)、
// 上游失败(单张探测抛错只丢那张,整批照样退出 preparing)、
// 非法状态迁移(探测期间用户先点了导出 → 探完不许把 exporting 打回 idle;卸载后不许再写 store)。
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// 顺序是硬要求:下面的 vi.mock 工厂引用了 harness 的替身对象,而 vi.mock 会被提到所有 import
// 之前注册、却在被测模块被求值时才执行工厂 —— harness 必须排在源码之前,否则 TDZ 直接报错。
import {
  exportTestDoubles,
  makeDeferred,
  makeImageFile,
  resetExportStore,
  resetExportTestDoubles,
  storeFiles,
  storeState
} from "./export-test-harness";
import { useExportStore } from "../../../../src/store/export";
import { useFilePreparation } from "../../../../src/routes/frames/[styleId]/export/use-file-preparation";

// 只替两个真异步边界:头部尺寸解析与 exifr,两者在 jsdom 里都没有真实现可跑。
vi.mock("../../../../src/utils/frame/export-pipeline", () => ({ ...exportTestDoubles }));
vi.mock("../../../../src/utils/frame/fields", () => ({
  extractPhotoExif: exportTestDoubles.extractPhotoExif,
  frameFieldsFromExif: exportTestDoubles.frameFieldsFromExif
}));

/** 往 store 里塞 n 张图并返回入队后的条目列表(store 会做判重与白名单过滤)。 */
function enqueue(count: number) {
  useExportStore.getState().addFiles(Array.from({ length: count }, () => makeImageFile()));
  return storeFiles();
}

function renderPreparation(files = storeFiles()) {
  return renderHook(() => useFilePreparation(files));
}

beforeEach(() => {
  resetExportTestDoubles();
  resetExportStore();
});

describe("探测与回写", () => {
  test("空值:一张图都没有时不动状态机、不发探测", () => {
    renderPreparation([]);

    expect(storeState().status).toBe("idle");
    expect(exportTestDoubles.probeSourceSize).not.toHaveBeenCalled();
    expect(exportTestDoubles.extractPhotoExif).not.toHaveBeenCalled();
  });

  test("两张图各探一次,尺寸与 EXIF 回写后自动退出 preparing", async () => {
    const files = enqueue(2);
    expect(storeState().status).toBe("idle");
    renderPreparation(files);

    await waitFor(() => {
      const [first, second] = storeFiles();
      expect(first.width).toBe(4000);
      expect(second.height).toBe(3000);
    });
    expect(storeFiles()[0].exif).toEqual({ cameraMake: "SONY" });
    expect(storeFiles()[0].exifReadAt).toEqual(expect.any(Number));
    await waitFor(() => expect(storeState().status).toBe("idle"));
  });

  test("越界:同一批文件重复渲染只探一次(探测是网络/解码级开销)", async () => {
    const files = enqueue(2);
    const { rerender } = renderPreparation(files);
    for (let index = 0; index < 5; index += 1) rerender();
    await waitFor(() => expect(storeState().status).toBe("idle"));

    expect(exportTestDoubles.probeSourceSize).toHaveBeenCalledTimes(2);
    expect(exportTestDoubles.extractPhotoExif).toHaveBeenCalledTimes(2);
  });

  test("零值:尺寸读不出来时保持 0(这是「未知」的合法终态,不许无限重探)", async () => {
    exportTestDoubles.probeSourceSize.mockResolvedValue(null);
    const files = enqueue(1);
    renderPreparation(files);

    await waitFor(() => expect(storeFiles()[0].exifReadAt).not.toBeNull());
    expect(storeFiles()[0].width).toBe(0);
    expect(exportTestDoubles.probeSourceSize).toHaveBeenCalledTimes(1);
    expect(storeState().status).toBe("idle");
  });

  test("上游失败:单张尺寸探测抛错只丢那张的尺寸,EXIF 照样落、整批照样退出 preparing", async () => {
    const files = enqueue(2);
    exportTestDoubles.probeSourceSize.mockImplementationOnce(() =>
      Promise.reject(new Error("解码二次兜底也失败"))
    );
    renderPreparation(files);

    await waitFor(() => expect(storeState().status).toBe("idle"));
    const [first, second] = storeFiles();
    // 尺寸读不到 = 保持 0(合法终态),但 EXIF 是独立的一路,不该被它连累。
    expect(first.width).toBe(0);
    expect(first.exif).toEqual({ cameraMake: "SONY" });
    expect(second.width).toBe(4000);
  });

  test("第二批入队只探新那张(已探过的按 entry id 记账,不重复解码)", async () => {
    let files = enqueue(1);
    const { rerender } = renderHook(() => useFilePreparation(files));
    await waitFor(() => expect(storeState().status).toBe("idle"));

    files = enqueue(1);
    rerender();
    await waitFor(() => expect(storeState().status).toBe("idle"));

    expect(exportTestDoubles.probeSourceSize).toHaveBeenCalledTimes(2);
    expect(storeFiles()).toHaveLength(2);
  });
});

describe("状态机与卸载安全", () => {
  test("进入 preparing 只在 idle 时发生:结果弹框还开着时插不进准备态", async () => {
    const files = enqueue(1);
    const deferred = makeDeferred<{ width: number; height: number } | null>();
    exportTestDoubles.probeSourceSize.mockReturnValue(deferred.promise);
    useExportStore.setState({ status: "done" });
    renderPreparation(files);

    await Promise.resolve();
    expect(storeState().status).toBe("done");
    deferred.resolve({ width: 100, height: 200 });
    await waitFor(() => expect(storeFiles()[0].width).toBe(100));
    expect(storeState().status).toBe("done");
  });

  test("非法状态迁移:探测期间用户点了导出,探完不许把 exporting 打回 idle", async () => {
    const files = enqueue(1);
    const deferred = makeDeferred<{ width: number; height: number } | null>();
    exportTestDoubles.probeSourceSize.mockReturnValue(deferred.promise);
    renderPreparation(files);

    await waitFor(() => expect(storeState().status).toBe("preparing"));
    // beginExport 允许从 preparing 进入(用户不必等探测完),之后进度就是主人。
    useExportStore.getState().beginExport(1);
    deferred.resolve({ width: 100, height: 200 });
    await act(async () => {
      await Promise.resolve();
    });

    expect(storeState().status).toBe("exporting");
  });

  test("上游失败:组件卸载后迟到的探测结果整条丢掉,不再写 store", async () => {
    const files = enqueue(1);
    const deferred = makeDeferred<{ width: number; height: number } | null>();
    exportTestDoubles.probeSourceSize.mockReturnValue(deferred.promise);
    const { unmount } = renderPreparation(files);

    await waitFor(() => expect(storeState().status).toBe("preparing"));
    unmount();
    deferred.resolve({ width: 4000, height: 3000 });
    await act(async () => {
      await Promise.resolve();
    });

    expect(storeFiles()[0].width).toBe(0);
    expect(storeFiles()[0].exifReadAt).toBeNull();
    // 卸载后连状态机都不许碰(否则会给已死的页面回写一个 idle)。
    expect(storeState().status).toBe("preparing");
  });
});
