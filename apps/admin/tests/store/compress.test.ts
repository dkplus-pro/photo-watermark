import { beforeEach, describe, expect, it } from "vitest";

import { useCompressStore } from "../../src/store/compress";
import type { CompressFileEntry } from "../../src/store/compress";

/**
 * 压缩 store 用例(范式同 store/export.test.ts)。
 * 六类边界对照:空值(空数组/未知 id)、零值(0 字节文件)、越界(手改 localStorage 的
 * 越界偏好)、权限缺失不适用(无鉴权)、网络失败不适用(纯本地)、
 * 非法状态迁移(queued→working→done|failed 之外的迁移一律幂等拒收)。
 */

const imageFile = (name: string, size = 10): File =>
  new File([new Uint8Array(size)], name, { type: "image/jpeg", lastModified: 1_000 });

const entryById = (id: string): CompressFileEntry => {
  const entry = useCompressStore.getState().files.find((item) => item.id === id);
  if (!entry) throw new Error(`测试条目 ${id} 不存在`);
  return entry;
};

const addOne = (name = "a.jpg", size = 10): string => {
  useCompressStore.getState().addFiles([imageFile(name, size)]);
  // 取最后一条:列表里可能已有此前步骤加入的条目,新条目恒追加在尾部。
  const { files } = useCompressStore.getState();
  const entry = files[files.length - 1];
  if (!entry) throw new Error("条目未入队");
  return entry.id;
};

beforeEach(() => {
  localStorage.clear();
  useCompressStore.setState({ files: [], mode: "smart", quality: 80 });
});

describe("addFiles", () => {
  it("受理图片并剥扩展名作为展示主名,id 逐条唯一", () => {
    useCompressStore.getState().addFiles([imageFile("照片一.jpg"), imageFile("照片二.jpg")]);
    const { files } = useCompressStore.getState();
    expect(files).toHaveLength(2);
    expect(files[0]?.baseName).toBe("照片一");
    expect(files[1]?.baseName).toBe("照片二");
    expect(files[0]?.id).not.toBe(files[1]?.id);
    expect(files[0]?.status).toBe("queued");
  });

  it("mime 与扩展名都不合法的文件拒收", () => {
    useCompressStore
      .getState()
      .addFiles([new File(["x"], "doc.txt", { type: "text/plain" }), new File(["x"], "movie.mp4")]);
    expect(useCompressStore.getState().files).toHaveLength(0);
  });

  it("同一文件重复添加按内容身份去重,同名不同内容照常收", () => {
    const file = imageFile("a.jpg");
    useCompressStore.getState().addFiles([file, file]);
    useCompressStore.getState().addFiles([imageFile("a.jpg", 999)]);
    const { files } = useCompressStore.getState();
    expect(files).toHaveLength(2);
  });

  it("空数组为 no-op(不产生新状态)", () => {
    const before = useCompressStore.getState();
    useCompressStore.getState().addFiles([]);
    expect(useCompressStore.getState()).toBe(before);
  });

  it("0 字节图片也受理(零值合法,压缩期按单张失败呈现)", () => {
    useCompressStore.getState().addFiles([new File([], "empty.png", { type: "image/png" })]);
    expect(useCompressStore.getState().files).toHaveLength(1);
  });
});

describe("removeFile / clearFiles / patchEntry", () => {
  it("removeFile 删除已知 id;未知 id(含已移除)no-op", () => {
    const id = addOne();
    useCompressStore.getState().removeFile(id);
    expect(useCompressStore.getState().files).toHaveLength(0);
    expect(() => useCompressStore.getState().removeFile(id)).not.toThrow();
    expect(useCompressStore.getState().files).toHaveLength(0);
  });

  it("clearFiles 清空列表;空列表 no-op", () => {
    addOne();
    useCompressStore.getState().clearFiles();
    expect(useCompressStore.getState().files).toHaveLength(0);
    const before = useCompressStore.getState();
    useCompressStore.getState().clearFiles();
    expect(useCompressStore.getState()).toBe(before);
  });

  it("patchEntry 回写尺寸与缩略图;未知 id no-op;同值不产生新状态", () => {
    const id = addOne();
    useCompressStore.getState().patchEntry(id, { width: 800, height: 600 });
    expect(entryById(id).width).toBe(800);
    const before = useCompressStore.getState();
    useCompressStore.getState().patchEntry(id, { width: 800, height: 600 });
    expect(useCompressStore.getState()).toBe(before);
    useCompressStore.getState().patchEntry("unknown", { width: 1, height: 1 });
    expect(useCompressStore.getState()).toBe(before);
  });
});

describe("状态机守卫", () => {
  it("markWorking:queued→working;重复回报幂等", () => {
    const id = addOne();
    useCompressStore.getState().markWorking(id);
    expect(entryById(id).status).toBe("working");
    const before = useCompressStore.getState();
    useCompressStore.getState().markWorking(id);
    expect(useCompressStore.getState()).toBe(before);
  });

  it("completeEntry 只有 working 能进 done,产物整体写入", () => {
    const id = addOne();
    const result = {
      blob: new Blob(["x"]),
      size: 1,
      width: 8,
      height: 8,
      mime: "image/jpeg" as const,
      fileName: "a.jpg"
    };
    useCompressStore.getState().completeEntry(id, result);
    expect(entryById(id).status).toBe("queued");
    useCompressStore.getState().markWorking(id);
    useCompressStore.getState().completeEntry(id, result);
    const entry = entryById(id);
    expect(entry.status).toBe("done");
    expect(entry.result?.fileName).toBe("a.jpg");
    expect(entry.errorMessage).toBeNull();
  });

  it("failEntry 只有 working 能进 failed,不覆盖已完成的条目", () => {
    const doneId = addOne("done.jpg");
    useCompressStore.getState().markWorking(doneId);
    useCompressStore.getState().completeEntry(doneId, {
      blob: new Blob(["x"]),
      size: 1,
      width: 8,
      height: 8,
      mime: "image/jpeg",
      fileName: "done.jpg"
    });
    useCompressStore.getState().failEntry(doneId, "迟到的失败");
    expect(entryById(doneId).status).toBe("done");

    const failedId = addOne("bad.jpg");
    useCompressStore.getState().markWorking(failedId);
    useCompressStore.getState().failEntry(failedId, "无法解码该图片");
    expect(entryById(failedId).status).toBe("failed");
    expect(entryById(failedId).errorMessage).toBe("无法解码该图片");
  });

  it("requeueWorking 只把 working 退回 queued,done/failed 不动", () => {
    const workingId = addOne("w.jpg");
    useCompressStore.getState().markWorking(workingId);
    const doneId = addOne("d.jpg");
    useCompressStore.getState().markWorking(doneId);
    useCompressStore.getState().completeEntry(doneId, {
      blob: new Blob(["x"]),
      size: 1,
      width: 8,
      height: 8,
      mime: "image/jpeg",
      fileName: "d.jpg"
    });
    useCompressStore.getState().requeueWorking();
    expect(entryById(workingId).status).toBe("queued");
    expect(entryById(doneId).status).toBe("done");
  });
});

describe("设置守卫与持久化白名单", () => {
  it("setMode/setQuality 拒收越界值,合法值生效", () => {
    useCompressStore.getState().setMode("webp");
    expect(useCompressStore.getState().mode).toBe("webp");
    useCompressStore.getState().setMode("png" as never);
    expect(useCompressStore.getState().mode).toBe("webp");

    useCompressStore.getState().setQuality(60);
    expect(useCompressStore.getState().quality).toBe(60);
    useCompressStore.getState().setQuality(10);
    useCompressStore.getState().setQuality(99.5 as never);
    expect(useCompressStore.getState().quality).toBe(60);
  });

  it("持久化只落白名单字段:File/Blob/status 一条都不进 localStorage", async () => {
    const id = addOne();
    useCompressStore.getState().markWorking(id);
    useCompressStore.getState().setQuality(65);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const raw = localStorage.getItem("image-compress.settings");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw ?? "{}") as { state?: Record<string, unknown> };
    expect(Object.keys(parsed.state ?? {})).toEqual(["mode", "quality"]);
  });

  it("rehydrate 只信白名单:越界偏好回落默认,files 不复活", async () => {
    localStorage.setItem(
      "image-compress.settings",
      JSON.stringify({ state: { mode: "png", quality: 1, files: [{ id: "ghost" }] }, version: 0 })
    );
    await useCompressStore.persist.rehydrate();
    const state = useCompressStore.getState();
    expect(state.mode).toBe("smart");
    expect(state.quality).toBe(80);
    expect(state.files).toHaveLength(0);
  });
});
