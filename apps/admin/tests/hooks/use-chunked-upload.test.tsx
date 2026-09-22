// use-chunked-upload 状态机用例(mock 边界:Controller 层 + axios 传输层,
// 不 mock hook 内部实现细节)。
// 覆盖:idle→preparing→uploading→completed;init 失败→failed;单片重试 2 次耗尽→failed;
// pause 中止在途;cancel 调 abortUpload 并清指纹、代次失效(旧 complete 返回不得覆盖新状态);
// resume 对账合并 fresh 分片;resumeSession 跳过 init;末片不足 chunkSize 的字节数折算。
// 注:start() 在同步 act 中发起(React 19 async act 会等待作用域内未决 thenable,
// 在途挂起分片会让 async act 无法收敛,故用 waitFor 轮询状态推进)。
import { act, renderHook, waitFor } from "@testing-library/react";
import { CanceledError } from "axios";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { UploadsController } from "../../src/api/controllers.gen";
import type { UploadedMedia, UploadSession } from "../../src/api/generated/cMSAdminAPI.schemas";
import { useChunkedUpload } from "../../src/hooks/use-chunked-upload";

// Controller 层 mock:hook 只经 UploadsController 与 axiosInstance(分片 PUT)触网。
vi.mock("../../src/api/controllers.gen", () => ({
  UploadsController: {
    initImageUpload: vi.fn(),
    initVideoUpload: vi.fn(),
    getUploadSession: vi.fn(),
    abortUpload: vi.fn(),
    completeUpload: vi.fn()
  }
}));

// client.ts 只 mock axios 实例的传输入口(分片 PUT 直发);token 注入等横切逻辑不在此测。
const { chunkPut } = vi.hoisted(() => ({ chunkPut: vi.fn() }));
vi.mock("../../src/api/client", () => ({ axiosInstance: { request: chunkPut } }));

const mockedInitImage = vi.mocked(UploadsController.initImageUpload);
const mockedGetSession = vi.mocked(UploadsController.getUploadSession);
const mockedAbort = vi.mocked(UploadsController.abortUpload);
const mockedComplete = vi.mocked(UploadsController.completeUpload);

// 10 字节文件,chunkSize=4 → 3 片(4/4/2),末片不足 chunkSize。
function makeFile(name = "a.png"): File {
  return new File([new Uint8Array(10)], name, { lastModified: 111, type: "image/png" });
}

function makeSession(overrides: Partial<UploadSession> = {}): UploadSession {
  return {
    uploadId: "upl-1",
    kind: "image",
    fileName: "a.png",
    size: 10,
    chunkSize: 4,
    chunkCount: 3,
    uploadedIndexes: [],
    ...overrides
  };
}

function resumeKey(file: File): string {
  return `admin.chunkedUpload.${encodeURIComponent(
    `${file.name}:${file.size}:${file.lastModified}`
  )}`;
}

const uploadedMedia: UploadedMedia = {
  id: 9,
  kind: "image",
  url: "",
  origName: "a.png",
  size: 10
};

type ChunkedUploadReturn = ReturnType<typeof useChunkedUpload>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockedAbort.mockResolvedValue(undefined);
  chunkPut.mockReset();
});

// 同步 act 中发起上传:start 的同步段(preparing 状态)在 act 内落定,
// init/分片等异步推进交给 waitFor 轮询或后续 await。
function startUpload(
  result: { current: ChunkedUploadReturn },
  file: File
): Promise<UploadedMedia | null> {
  let promise!: Promise<UploadedMedia | null>;
  act(() => {
    promise = result.current.start(file);
  });
  return promise;
}

describe("useChunkedUpload 状态机", () => {
  test("初始状态为 idle", () => {
    const { result } = renderHook(() => useChunkedUpload("image"));
    expect(result.current.state).toEqual({
      status: "idle",
      fileName: "",
      totalBytes: 0,
      uploadedBytes: 0
    });
  });

  test("成功路径:idle→preparing→uploading→completed,末片字节数折算,指纹清除", async () => {
    mockedInitImage.mockResolvedValue(makeSession());
    mockedComplete.mockResolvedValue(uploadedMedia);
    chunkPut.mockResolvedValue({});
    const { result } = renderHook(() => useChunkedUpload("image"));
    const file = makeFile();

    const promise = startUpload(result, file);
    const media = await act(() => promise);

    expect(media).toEqual(uploadedMedia);
    expect(result.current.state.status).toBe("completed");
    expect(result.current.state.uploadedBytes).toBe(10);
    // init 请求参数
    expect(mockedInitImage).toHaveBeenCalledWith({
      fileName: "a.png",
      size: 10,
      groupId: undefined
    });
    // 3 片全部直发,末片(索引 2)只含 2 字节(10 - 2*4)
    expect(chunkPut).toHaveBeenCalledTimes(3);
    const calls = chunkPut.mock.calls.map((call) => call[0]);
    expect(calls.map((config) => config.url)).toEqual([
      "/api/admin/uploads/upl-1/chunks/0",
      "/api/admin/uploads/upl-1/chunks/1",
      "/api/admin/uploads/upl-1/chunks/2"
    ]);
    expect(calls.map((config) => (config.data as Blob).size)).toEqual([4, 4, 2]);
    // 完成后断点续传指纹清除
    expect(localStorage.getItem(resumeKey(file))).toBeNull();
  });

  test("init 失败→failed,不写指纹", async () => {
    mockedInitImage.mockRejectedValue(new Error("quota exceeded"));
    const { result } = renderHook(() => useChunkedUpload("image"));
    const file = makeFile();

    const promise = startUpload(result, file);
    await act(() => promise);

    expect(result.current.state.status).toBe("failed");
    expect(result.current.state.fileName).toBe("a.png");
    expect(localStorage.getItem(resumeKey(file))).toBeNull();
  });

  test("单片重试 2 次耗尽→failed(3 片 × 3 次尝试)", async () => {
    vi.useFakeTimers();
    try {
      mockedInitImage.mockResolvedValue(makeSession());
      chunkPut.mockRejectedValue(new Error("network down"));
      const { result } = renderHook(() => useChunkedUpload("image"));
      const file = makeFile();

      const promise = startUpload(result, file);
      // 退避 1s + 2s,覆盖全部重试
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      const media = await act(() => promise);

      expect(media).toBeNull();
      expect(result.current.state.status).toBe("failed");
      expect(chunkPut).toHaveBeenCalledTimes(9);
      // 失败保留指纹,可续传
      expect(localStorage.getItem(resumeKey(file))).toBe("upl-1");
    } finally {
      vi.useRealTimers();
    }
  });

  test("pause 中止在途分片→paused;resume 对账合并 fresh 分片后续传至 completed", async () => {
    // 在途分片挂起,直到 AbortSignal 触发(等价真实 axios 的 abort 语义)
    chunkPut.mockImplementation(({ signal }: { signal?: AbortSignal }) => {
      if (signal?.aborted) {
        return Promise.reject(new CanceledError());
      }
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new CanceledError()));
      });
    });
    mockedInitImage.mockResolvedValue(makeSession());
    const { result } = renderHook(() => useChunkedUpload("image"));
    const file = makeFile();

    const promise = startUpload(result, file);
    await waitFor(() => expect(result.current.state.status).toBe("uploading"));
    expect(chunkPut).toHaveBeenCalledTimes(3);

    act(() => {
      result.current.pause();
    });
    // 在途请求被 abort 后 worker 退出,start promise 以 null 落定
    await act(async () => {
      await promise;
    });
    expect(result.current.state.status).toBe("paused");
    expect(mockedComplete).not.toHaveBeenCalled();

    // resume:对账发现 0/1 两片服务端已落盘,只需补第 2 片
    mockedGetSession.mockResolvedValue(makeSession({ uploadedIndexes: [0, 1] }));
    chunkPut.mockReset();
    chunkPut.mockResolvedValue({});
    mockedComplete.mockResolvedValue(uploadedMedia);

    await act(async () => {
      await result.current.resume();
    });

    expect(mockedGetSession).toHaveBeenCalledWith("upl-1");
    expect(chunkPut).toHaveBeenCalledTimes(1);
    expect(chunkPut.mock.calls[0][0].url).toBe("/api/admin/uploads/upl-1/chunks/2");
    expect(result.current.state.status).toBe("completed");
    expect(result.current.state.uploadedBytes).toBe(10);
  });

  test("cancel:调 abortUpload、清指纹、状态 cancelled;挂起的旧 complete 返回不得覆盖新状态", async () => {
    chunkPut.mockResolvedValue({});
    let resolveComplete!: (media: UploadedMedia) => void;
    mockedComplete.mockImplementation(
      () =>
        new Promise<UploadedMedia>((resolve) => {
          resolveComplete = resolve;
        })
    );
    mockedInitImage.mockResolvedValue(makeSession());
    const { result } = renderHook(() => useChunkedUpload("image"));
    const file = makeFile();

    const promise = startUpload(result, file);
    // 分片传完,停在挂起的 complete(状态 uploading)
    await waitFor(() => expect(chunkPut).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.state.status).toBe("uploading"));
    expect(localStorage.getItem(resumeKey(file))).toBe("upl-1");

    act(() => {
      result.current.cancel();
    });
    expect(result.current.state.status).toBe("cancelled");
    expect(mockedAbort).toHaveBeenCalledWith("upl-1");
    expect(localStorage.getItem(resumeKey(file))).toBeNull();

    // 旧 complete 迟迟返回:代次已失效,不得把状态拉回 completed
    await act(async () => {
      resolveComplete(uploadedMedia);
      await promise;
    });
    expect(result.current.state.status).toBe("cancelled");

    // 取消后 resume 不再动作(会话引用已清空)
    await act(async () => {
      await result.current.resume();
    });
    expect(result.current.state.status).toBe("cancelled");
    expect(mockedGetSession).not.toHaveBeenCalled();
  });

  test("resumeSession 续传:跳过 init,从缺失分片继续", async () => {
    const resumed = makeSession({ uploadedIndexes: [0] });
    chunkPut.mockResolvedValue({});
    mockedComplete.mockResolvedValue(uploadedMedia);
    const { result } = renderHook(() => useChunkedUpload("image"));
    const file = makeFile();

    let promise!: Promise<UploadedMedia | null>;
    act(() => {
      promise = result.current.start(file, { resumeSession: resumed });
    });
    const media = await act(() => promise);

    expect(mockedInitImage).not.toHaveBeenCalled();
    expect(media).toEqual(uploadedMedia);
    expect(result.current.state.status).toBe("completed");
    expect(chunkPut).toHaveBeenCalledTimes(2);
    expect(chunkPut.mock.calls.map((call) => call[0].url)).toEqual([
      "/api/admin/uploads/upl-1/chunks/1",
      "/api/admin/uploads/upl-1/chunks/2"
    ]);
  });
});
