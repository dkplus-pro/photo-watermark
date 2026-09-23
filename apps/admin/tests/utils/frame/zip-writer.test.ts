import { describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";

import * as harness from "./export-test-harness";

vi.mock("../../../src/utils/frame/worker-pool", () => ({
  createFrameWorkerPool: harness.workerPoolMock.createFrameWorkerPool
}));
vi.mock("../../../src/utils/frame/render-core", () => harness.renderCoreMock);
vi.mock("../../../src/utils/frame/fields", () => harness.fieldsMock);
vi.mock("../../../src/utils/frame/capability", async (importOriginal) =>
  harness.capabilityMock(importOriginal)
);

import { createZipWriter } from "../../../src/utils/frame/zip-writer";
import { runFrameExport } from "../../../src/utils/frame/export-pipeline";

/**
 * 流式打包单测(被测模块 `src/utils/frame/zip-writer.ts`)。
 *
 * 「STORE 不二次压缩」「同名去重」「包结构能被独立实现解开」这三条只能在**真实字节**上断言,
 * 所以走 `zip-writer` 的真实现;而它的对外形状是「逐张 add + finish 出 Blob」,最有说服力的
 * 验证是把整包交给另一个解压实现(`fflate.unzipSync`)与中央目录解析器双向对账。
 * 因此出包用例经 `runFrameExport` 驱动(与真实调用方一致),只有「已放弃的包」直接打 `ZipWriter`。
 *
 * 六类边界:空值/零值(空条目由 `add` 的字节长度体现,已在流水线侧覆盖)、越界(同名上千退回
 * 时间戳,由 `utils/file-name` 的用例覆盖)、权限缺失(不适用)、网络失败(不适用)、
 * 非法状态迁移(discard 后仍 add / finish)。
 */

harness.installExportBoundaryHooks();

describe("createZipWriter · 落包结构与名字", () => {
  it("正常出包:一个 STORE zip,条目名字与字节逐条对得上,汇总字段完整", async () => {
    const ledger = harness.createLedger();
    harness.autoSuccess(ledger);
    const summary = await runFrameExport(
      [harness.jpegFile("a.jpg"), harness.jpegFile("b.jpg", 800, 600, 1001)],
      harness.settings
    );
    expect(summary.succeeded).toBe(2);
    expect(summary.total).toBe(2);
    expect(summary.failures).toEqual([]);
    expect(summary.zipFileName).toMatch(/^frame-export-\d{4}-\d{2}-\d{2}\.zip$/u);
    expect(summary.zip.type).toBe("application/zip");

    const entries = await harness.readZip(summary.zip);
    expect(entries.map((entry) => entry.name)).toEqual(["a.jpg", "b.jpg"]);
    // level 0:JPEG 已是熵编码,再套 deflate 只烧 CPU(方案里「Zip({ level: 0 })」的实际形态)
    expect(entries.every((entry) => entry.compression === 0)).toBe(true);
    expect(entries.every((entry) => entry.compressedSize === entry.size)).toBe(true);
    expect(entries.map((entry) => entry.compressedSize)).toEqual([1, 1]); // 产物字节就是任务主名(见下)
    // 独立实现复核:fflate 自己也解得开,内容逐条对得上,说明包结构合法而不只是头部看着像
    const unzipped = unzipSync(new Uint8Array(await summary.zip.arrayBuffer()));
    expect(Object.keys(unzipped)).toEqual(["a.jpg", "b.jpg"]);
    expect(new TextDecoder().decode(unzipped["a.jpg"])).toBe("a");
    expect(new TextDecoder().decode(unzipped["b.jpg"])).toBe("b");
    expect(harness.onlyPool().terminateCalls).toBe(1); // 正常路径也要关池
  });

  it("zip 内同名去重:第二张落 -2 而不是被覆盖", async () => {
    harness.autoSuccess(harness.createLedger());
    const summary = await runFrameExport(
      [harness.jpegFile("IMG_1.jpg", 400, 300, 1), harness.jpegFile("IMG_1.jpg", 400, 300, 2)],
      harness.settings
    );
    const entries = await harness.readZip(summary.zip);
    expect(entries.map((entry) => entry.name)).toEqual(["IMG_1.jpg", "IMG_1-2.jpg"]);
    expect(summary.succeeded).toBe(2);
  });
});

describe("createZipWriter · 已放弃的包", () => {
  it("非法状态迁移:已放弃的包再写入一律报「压缩包写入失败」前缀", async () => {
    const writer = createZipWriter();
    writer.discard();
    await expect(writer.add("a.jpg", new Blob(["x"]))).rejects.toThrow("压缩包写入失败");
    // finish 的前置校验是同步抛错(它没有 await),包成函数再断言
    expect(() => {
      void writer.finish();
    }).toThrow("压缩包写入失败");
  });
});
