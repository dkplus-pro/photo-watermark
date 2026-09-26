// 导出表单 store 用例(阶段 7:表单状态 + 导出进度状态机)。
// 六类边界覆盖:
//   空值 —— addFiles([])/未知 id 的 patchFile 与 removeFile 必须零副作用(连订阅通知都不发);
//   零值 —— beginExport(0) 之后不计数、finishExport 在 done=0 时仍按 done 落态(全失败由页面裁决);
//   越界 —— total=2 时连报 5 次必须收敛在 2(Worker 乱序/重复回报的真实风险);重复文件必须跳过;
//   权限缺失 —— 本站无鉴权(纯静态、匿名可用),此一类不适用;
//   网络失败 —— 本模块不请求网络,failExport 承载上游(流水线/打包)失败消息,有用例;
//   非法状态迁移 —— exporting 重入 beginExport、done 后回报、取消后回报、终态被失败覆盖,全部要挡。
// 持久化另开一组:白名单只留 sizeTier/logoId/logoSize,File 与 status 绝不允许落盘或复活。
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  CUSTOM_LOGO_ID,
  MOBILE_SOFT_LIMIT,
  NO_LOGO_ID,
  useExportStore
} from "../../src/store/export";
import type { ExportFileEntry } from "../../src/store/export";
import { PLAIN_FRAME_STYLE_ID } from "../../src/utils/frame/style-registry";
import {
  DEFAULT_LOGO_SIZE,
  DEFAULT_SIZE_TIER,
  LOGO_SIZE_MAX,
  LOGO_SIZE_MIN
} from "../../src/utils/frame/types";
import type { FrameFailure, FrameTaskResult } from "../../src/utils/frame/types";

const STORAGE_KEY = "watermark-frame.export";

const snapshot = () => useExportStore.getState();

// 内容字节决定 size,从而决定判重签名:同名不同内容必然 size 或 lastModified 不同。
const makeFile = (name: string, bytes: number = 3, lastModified?: number): File =>
  new File([new Uint8Array(bytes)], name, {
    type: name.endsWith(".png") ? "image/png" : "image/jpeg",
    ...(lastModified === undefined ? {} : { lastModified })
  });

const okResult = (jobId: string): FrameTaskResult => ({
  jobId,
  fileName: `${jobId}.jpg`,
  blob: new Blob(["jpeg-bytes"]),
  width: 400,
  height: 300,
  usedWorker: true,
  exifInjected: true
});

const badResult = (jobId: string): FrameFailure => ({
  jobId,
  fileName: `${jobId}.jpg`,
  message: "图像解码失败"
});

// persist 的 rehydrate 在 create<S>()(persist(...)) 写法下不进推断类型,测试里按运行期形状取一次。
const rehydrate = () =>
  (useExportStore as unknown as { persist: { rehydrate: () => unknown } }).persist.rehydrate();

beforeEach(() => {
  window.localStorage.clear();
  useExportStore.setState(useExportStore.getInitialState());
});

describe("addFiles 受理与判重", () => {
  // 空值
  test("addFiles([]) 不改 state,也不通知订阅者", () => {
    const before = snapshot();
    const listener = vi.fn();
    const unsubscribe = useExportStore.subscribe(listener);

    before.addFiles([]);

    expect(snapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("非图片类型按 type 与扩展名双重判定:txt 拒收,type 空的 heic 仍收", () => {
    const plainText = new File([new Uint8Array(4)], "readme.txt", { type: "text/plain" });
    // 系统/拖拽场景下 heic 的 type 常为空串,只能靠扩展名放行。
    const heicNoType = new File([new Uint8Array(4)], "IMG_0001.HEIC", { type: "" });

    snapshot().addFiles([plainText, heicNoType]);

    const files = snapshot().files;
    expect(files).toHaveLength(1);
    expect(files[0].baseName).toBe("IMG_0001");
    expect(files[0].id).not.toBe("");
  });

  test("扩展名合法但内容不是图仍然收下(D7:解码失败进失败列表,不在选择期做 magic number 校验)", () => {
    const fakeJpeg = new File([new Uint8Array([0, 0, 0, 0])], "broken.jpg", { type: "image/jpeg" });

    snapshot().addFiles([fakeJpeg]);

    expect(snapshot().files).toHaveLength(1);
    expect(snapshot().files[0].file).toBe(fakeJpeg);
  });

  test("同一文件重复添加跳过:同一引用与重选后的新引用(同名同 size 同 lastModified)都算重复", () => {
    const first = makeFile("a.jpg", 5);
    snapshot().addFiles([first]);
    // 用户重新点开文件选择器:内容没变,但浏览器给的是新 File 对象。
    const reselected = makeFile("a.jpg", 5, first.lastModified);

    snapshot().addFiles([first, reselected]);

    expect(snapshot().files).toHaveLength(1);
    expect(snapshot().files[0].file).toBe(first);
  });

  test("同名不同内容都收(判重看文件身份不看名字),且 id 互不相同", () => {
    const small = makeFile("a.jpg", 2);
    const large = makeFile("a.jpg", 900);
    snapshot().addFiles([small, large]);

    const files = snapshot().files;
    expect(files).toHaveLength(2);
    expect(files.map((entry) => entry.baseName)).toEqual(["a", "a"]);
    expect(new Set(files.map((entry) => entry.id)).size).toBe(2);
  });

  test("批量无硬上限(用户要批量导出),张数软提示由页面按 files.length 判断;常量导出为 20", () => {
    expect(MOBILE_SOFT_LIMIT).toBe(20);
    const batch = Array.from({ length: 25 }, (_unused, index) => makeFile(`batch-${index}.jpg`, 3));

    snapshot().addFiles(batch);

    expect(snapshot().files).toHaveLength(25);
    expect(snapshot().files.length).toBeGreaterThan(MOBILE_SOFT_LIMIT);
  });

  test("新入列表的条目处于「未读 EXIF、未探测尺寸、未产缩略图」状态", () => {
    snapshot().addFiles([makeFile("x.jpg", 7)]);

    const entry = snapshot().files[0];
    expect(entry.exif).toBeNull();
    expect(entry.exifReadAt).toBeNull();
    expect(entry.width).toBe(0);
    expect(entry.height).toBe(0);
    expect(entry.thumb).toBeNull();
    expect(entry.size).toBe(7);
  });

  test("多扩展名主名只去掉最后一段(.b.jpg → .b,无扩展名按整名)", () => {
    snapshot().addFiles([
      makeFile("holiday.b.jpg", 1),
      new File([new Uint8Array(2)], "plainname", { type: "image/png" })
    ]);

    expect(snapshot().files.map((entry) => entry.baseName)).toEqual(["holiday.b", "plainname"]);
  });
});

describe("patchFile / removeFile / clearFiles", () => {
  const seedOne = (): ExportFileEntry => {
    useExportStore.getState().addFiles([makeFile("p.jpg", 4)]);
    return snapshot().files[0];
  };

  // 空值
  test("未知 id 的 patchFile 与 removeFile 静默无副作用,不通知订阅者", () => {
    seedOne();
    const listener = vi.fn();
    const unsubscribe = useExportStore.subscribe(listener);

    snapshot().patchFile("no-such-id", { width: 100, height: 200, exif: { iso: 100 } });
    snapshot().removeFile("no-such-id");

    expect(snapshot().files[0].width).toBe(0);
    expect(snapshot().files).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("写入 exif 即标记读取时刻,与「尚未读取」区分开", () => {
    const entry = seedOne();

    snapshot().patchFile(entry.id, { exif: { cameraModel: "X100", iso: 200 }, width: 6000 });

    const patched = snapshot().files[0];
    expect(patched.exif).toEqual({ cameraModel: "X100", iso: 200 });
    expect(patched.width).toBe(6000);
    expect(patched.exifReadAt).not.toBeNull();
    // 只补尺寸不再动读取标记。
    const readAt = patched.exifReadAt;
    snapshot().patchFile(entry.id, { height: 4000 });
    expect(snapshot().files[0].exifReadAt).toBe(readAt);
    expect(snapshot().files[0].height).toBe(4000);
  });

  test("读失败(exif 显式 null)与未读可用 exifReadAt 区分", () => {
    const entry = seedOne();

    snapshot().patchFile(entry.id, { exif: null });

    const failed = snapshot().files[0];
    expect(failed.exif).toBeNull();
    expect(failed.exifReadAt).not.toBeNull();
  });

  test("缩略图补丁独立成路:EXIF 没回写时也能落进 entry(两路读取互不连累)", () => {
    const entry = seedOne();
    const thumb = new Blob(["thumb-bytes"], { type: "image/jpeg" });

    snapshot().patchFile(entry.id, { thumb });

    expect(snapshot().files[0].thumb).toBe(thumb);
    // 缩略图不是「读过 EXIF」的凭据,不能顺带动 exifReadAt。
    expect(snapshot().files[0].exifReadAt).toBeNull();
  });

  test("同值补丁短路:不产生新数组,也不通知订阅者", () => {
    const entry = seedOne();
    const before = snapshot().files;
    const listener = vi.fn();
    const unsubscribe = useExportStore.subscribe(listener);

    snapshot().patchFile(entry.id, { width: 0, height: 0 });

    expect(snapshot().files).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("removeFile 摘掉指定条目,clearFiles 清空", () => {
    snapshot().addFiles([makeFile("one.jpg", 1), makeFile("two.jpg", 2)]);
    const [firstEntry, secondEntry] = snapshot().files;

    snapshot().removeFile(firstEntry.id);
    expect(snapshot().files.map((entry) => entry.id)).toEqual([secondEntry.id]);

    snapshot().clearFiles();
    expect(snapshot().files).toEqual([]);
  });
});

describe("导出状态机:合法迁移", () => {
  test("idle → exporting 归零计数与失败明细", () => {
    snapshot().beginExport(3);

    const state = snapshot();
    expect(state.status).toBe("exporting");
    expect(state).toMatchObject({ done: 0, failedCount: 0, total: 3, failures: [], error: null });
    expect(state.zipFileName).toBeNull();
  });

  test("preparing(页面探测阶段)→ exporting 允许,由页面经 setState 显式写入 preparing", () => {
    useExportStore.setState({ status: "preparing" });

    snapshot().beginExport(1);

    expect(snapshot().status).toBe("exporting");
  });

  test("正常批次:done 与 failedCount 各自累加,failures 保留回报顺序", () => {
    snapshot().beginExport(3);

    snapshot().markJobDone(okResult("job-1"));
    snapshot().markJobFailed(badResult("job-2"));
    snapshot().markJobDone(okResult("job-3"));

    const state = snapshot();
    expect(state).toMatchObject({ done: 2, failedCount: 1, total: 3 });
    expect(state.failures.map((failure) => failure.jobId)).toEqual(["job-2"]);
  });

  test("finishExport 落 done + zip 名,导出产物文件名可下载", () => {
    snapshot().beginExport(2);
    snapshot().markJobDone(okResult("job-1"));
    snapshot().markJobDone(okResult("job-2"));

    snapshot().finishExport("watermark-frame.zip");

    expect(snapshot()).toMatchObject({ status: "done", zipFileName: "watermark-frame.zip" });
  });

  test("cancelExport 回 idle 但保留已完成计数与失败明细(用户要看「已完成 12/50 时取消」)", () => {
    snapshot().beginExport(50);
    snapshot().markJobDone(okResult("job-1"));
    snapshot().markJobFailed(badResult("job-2"));

    snapshot().cancelExport();

    const state = snapshot();
    expect(state.status).toBe("idle");
    expect(state).toMatchObject({ done: 1, failedCount: 1, total: 50 });
    expect(state.failures).toHaveLength(1);
    expect(state.zipFileName).toBeNull();
  });

  // 网络失败一类:本模块无网络,failExport 承载上游失败消息。
  test("failExport 记录上游失败消息,已统计的进度保留", () => {
    snapshot().beginExport(10);
    snapshot().markJobDone(okResult("job-1"));

    snapshot().failExport("打包失败:浏览器拒绝写入临时文件");

    expect(snapshot()).toMatchObject({
      status: "failed",
      error: "打包失败:浏览器拒绝写入临时文件",
      done: 1,
      total: 10
    });
  });

  test("reset 保留档位、logo 与 logo大小偏好,清掉文件、进度与产物", () => {
    snapshot().addFiles([makeFile("keep-me.jpg", 3)]);
    snapshot().setSizeTier("small");
    snapshot().setLogoId(CUSTOM_LOGO_ID);
    snapshot().setLogoSize(6);
    snapshot().setCustomLogo(makeFile("logo.png", 9));
    snapshot().beginExport(1);
    snapshot().markJobDone(okResult("job-1"));

    snapshot().reset();

    const state = snapshot();
    expect(state.sizeTier).toBe("small");
    expect(state.logoId).toBe(CUSTOM_LOGO_ID);
    expect(state.logoSize).toBe(6);
    expect(state.files).toEqual([]);
    expect(state.customLogoFile).toBeNull();
    expect(state).toMatchObject({ status: "idle", done: 0, failedCount: 0, total: 0 });
    expect(state.failures).toEqual([]);
    expect(state.zipFileName).toBeNull();
  });
});

describe("导出状态机:非法迁移与越界收敛", () => {
  // 越界
  test("total=2 时连报 5 次成功:done 收敛在 2,不越界", () => {
    snapshot().beginExport(2);

    for (let index = 0; index < 5; index += 1) {
      snapshot().markJobDone(okResult(`job-${index}`));
    }

    expect(snapshot().done).toBe(2);
  });

  test("done + failedCount 合计不超过 total:名额用尽后的失败回报也不进明细", () => {
    snapshot().beginExport(3);
    snapshot().markJobDone(okResult("job-1"));
    snapshot().markJobDone(okResult("job-2"));

    snapshot().markJobFailed(badResult("job-3"));
    snapshot().markJobFailed(badResult("job-4"));

    expect(snapshot()).toMatchObject({ done: 2, failedCount: 1, total: 3 });
    expect(snapshot().failures.map((failure) => failure.jobId)).toEqual(["job-3"]);
  });

  // 零值
  test("beginExport(0):进入 exporting 后任何回报都不计数,finishExport 仍能把 done=0 落态", () => {
    snapshot().beginExport(0);

    snapshot().markJobDone(okResult("job-1"));
    snapshot().markJobFailed(badResult("job-2"));
    snapshot().finishExport("empty.zip");

    const state = snapshot();
    expect(state).toMatchObject({ status: "done", total: 0, done: 0, failedCount: 0 });
    expect(state.failures).toEqual([]);
  });

  test("负数与 NaN 的 total 收敛为 0,不产生负名额", () => {
    snapshot().beginExport(-5);
    expect(snapshot().total).toBe(0);

    snapshot().cancelExport();
    snapshot().beginExport(Number.NaN);
    expect(snapshot().total).toBe(0);
  });

  // 非法状态迁移
  test("exporting 中重复 beginExport 被忽略(双击导出按钮不会起两条流水线抢 Worker)", () => {
    snapshot().beginExport(5);
    snapshot().markJobDone(okResult("job-1"));

    snapshot().beginExport(99);

    expect(snapshot()).toMatchObject({ status: "exporting", total: 5, done: 1 });
  });

  test("done / failed 终态必须经 reset 才能重开", () => {
    snapshot().beginExport(1);
    snapshot().markJobDone(okResult("job-1"));
    snapshot().finishExport("pack.zip");

    snapshot().beginExport(4);
    expect(snapshot()).toMatchObject({ status: "done", total: 1 });

    snapshot().reset();
    snapshot().beginExport(4);
    expect(snapshot()).toMatchObject({ status: "exporting", total: 4 });
  });

  test("failed 之后 beginExport 与 cancelExport 都被忽略,只有 reset 能重开", () => {
    snapshot().beginExport(2);
    snapshot().markJobFailed(badResult("job-1"));
    snapshot().failExport("Worker 池整体崩溃");

    snapshot().beginExport(3);
    snapshot().cancelExport();
    expect(snapshot()).toMatchObject({ status: "failed", failedCount: 1, total: 2 });

    snapshot().reset();
    snapshot().beginExport(3);
    expect(snapshot()).toMatchObject({ status: "exporting", total: 3, failedCount: 0 });
  });

  test("未 beginExport 的回报一律无效", () => {
    snapshot().markJobDone(okResult("job-1"));
    snapshot().markJobFailed(badResult("job-2"));

    expect(snapshot()).toMatchObject({ status: "idle", done: 0, failedCount: 0, total: 0 });
    expect(snapshot().failures).toEqual([]);
  });

  test("cancelExport 之后迟到的回报不再计数(进度条不会复活)", () => {
    snapshot().beginExport(4);
    snapshot().markJobDone(okResult("job-1"));
    snapshot().cancelExport();

    snapshot().markJobDone(okResult("job-2"));
    snapshot().markJobFailed(badResult("job-3"));
    snapshot().finishExport("late.zip");

    expect(snapshot()).toMatchObject({ status: "idle", done: 1, failedCount: 0 });
    expect(snapshot().zipFileName).toBeNull();
  });

  test("done 之后 markJobDone 与迟到的 failExport 都不改终态", () => {
    snapshot().beginExport(1);
    snapshot().markJobDone(okResult("job-1"));
    snapshot().finishExport("pack.zip");

    snapshot().markJobDone(okResult("job-2"));
    snapshot().failExport("上游说失败了");

    expect(snapshot()).toMatchObject({ status: "done", done: 1, error: null });
  });

  test("非 exporting 的 finishExport 被忽略", () => {
    snapshot().finishExport("too-early.zip");
    expect(snapshot()).toMatchObject({ status: "idle", zipFileName: null });
  });

  test("回报缺 jobId 的脏消息丢弃,既不计数也不记失败", () => {
    snapshot().beginExport(2);

    snapshot().markJobDone(okResult(""));
    snapshot().markJobFailed({ jobId: "", fileName: "x.jpg", message: "解码失败" });

    expect(snapshot()).toMatchObject({ done: 0, failedCount: 0, total: 2 });
  });
});

describe("表单选项 setter", () => {
  test("默认样式与默认档位取自渲染契约", () => {
    const state = snapshot();
    expect(state.styleId).toBe(PLAIN_FRAME_STYLE_ID);
    expect(state.sizeTier).toBe(DEFAULT_SIZE_TIER);
    expect(state.logoId).toBe(NO_LOGO_ID);
    expect(state.logoSize).toBe(DEFAULT_LOGO_SIZE);
  });

  test("setter 同值写入短路,不通知订阅者", () => {
    const tier = snapshot().sizeTier;
    const listener = vi.fn();
    const unsubscribe = useExportStore.subscribe(listener);

    snapshot().setSizeTier(tier);
    snapshot().setStyleId(PLAIN_FRAME_STYLE_ID);
    snapshot().setLogoId(NO_LOGO_ID);
    snapshot().setLogoSize(DEFAULT_LOGO_SIZE);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("setLogoId(custom) 与 setCustomLogo(null) 都不互相回退:边界归属页面校验", () => {
    snapshot().setLogoId(CUSTOM_LOGO_ID);
    expect(snapshot().logoId).toBe(CUSTOM_LOGO_ID);
    expect(snapshot().customLogoFile).toBeNull();

    snapshot().setCustomLogo(makeFile("logo.png", 4));
    snapshot().setCustomLogo(null);

    expect(snapshot().logoId).toBe(CUSTOM_LOGO_ID);
    expect(snapshot().customLogoFile).toBeNull();
  });

  test("setLogoSize 只收 5–10 的整数:越界、小数与非数字一律拒收", () => {
    snapshot().setLogoSize(LOGO_SIZE_MIN);
    expect(snapshot().logoSize).toBe(LOGO_SIZE_MIN);

    snapshot().setLogoSize(LOGO_SIZE_MAX);
    expect(snapshot().logoSize).toBe(LOGO_SIZE_MAX);

    for (const dirty of [LOGO_SIZE_MIN - 1, LOGO_SIZE_MAX + 1, 7.5, Number.NaN, "6"]) {
      snapshot().setLogoSize(dirty as unknown as number);
      expect(snapshot().logoSize).toBe(LOGO_SIZE_MAX);
    }
  });
});

describe("偏好持久化白名单", () => {
  test("写盘的只有 sizeTier、logoId 与 logoSize,不含 files/status/File/进度", () => {
    snapshot().addFiles([makeFile("a.jpg", 3)]);
    snapshot().setSizeTier("small");
    snapshot().setLogoId(CUSTOM_LOGO_ID);
    snapshot().setLogoSize(6);
    snapshot().beginExport(1);

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw ?? "{}") as { state: Record<string, unknown> };
    expect(stored.state).toEqual({
      sizeTier: "small",
      logoId: CUSTOM_LOGO_ID,
      logoSize: 6
    });
    expect(stored.state).not.toHaveProperty("files");
    expect(stored.state).not.toHaveProperty("status");
    expect(stored.state).not.toHaveProperty("customLogoFile");
    expect(stored.state).not.toHaveProperty("done");
    expect(stored.state).not.toHaveProperty("total");
  });

  test("刷新后档位、logo 与 logo大小生效,而 payload 里被塞进的僵尸态与文件不复活", () => {
    snapshot().setSizeTier("original");
    snapshot().setLogoId("preset-silver");

    const poisoned = JSON.stringify({
      state: {
        sizeTier: "medium",
        logoId: NO_LOGO_ID,
        logoSize: 7,
        status: "exporting",
        done: 7,
        total: 7,
        files: [{ id: "ghost", name: "不该存在" }]
      }
    });
    window.localStorage.setItem(STORAGE_KEY, poisoned);

    rehydrate();

    const state = snapshot();
    expect(state.sizeTier).toBe("medium");
    expect(state.logoId).toBe(NO_LOGO_ID);
    expect(state.logoSize).toBe(7);
    expect(state.status).toBe("idle");
    expect(state.done).toBe(0);
    expect(state.files).toEqual([]);
  });

  test("持久化值非法(旧版本残留或手改 storage)时保持当前值,不把 store 写成脏值", () => {
    snapshot().setSizeTier("small");
    snapshot().setLogoId(CUSTOM_LOGO_ID);
    snapshot().setLogoSize(6);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { sizeTier: "ultra-hd", logoId: 42, logoSize: LOGO_SIZE_MAX + 1 }
      })
    );

    rehydrate();

    const state = snapshot();
    expect(state.sizeTier).toBe("small");
    expect(state.logoId).toBe(CUSTOM_LOGO_ID);
    expect(state.logoSize).toBe(6);
  });
});
