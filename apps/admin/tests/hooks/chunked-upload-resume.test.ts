// chunked-upload-resume 用例:断点续传会话指纹(fileName+size+lastModified)存取/清除/命中。
// 边界:无记录;会话已被服务端清理(404);同名文件不同指纹不命中;
// localStorage 抛异常(隐私模式)不向上冒泡。
import { beforeEach, describe, expect, test, vi } from "vitest";

import { UploadsController } from "../../src/api/controllers.gen";
import type { UploadSession } from "../../src/api/generated/cMSAdminAPI.schemas";
import {
  clearResumableUploadId,
  findResumableSession,
  saveResumableUploadId
} from "../../src/hooks/chunked-upload-resume";

vi.mock("../../src/api/controllers.gen", () => ({
  UploadsController: {
    getUploadSession: vi.fn(),
    abortUpload: vi.fn()
  }
}));

const mockedGetSession = vi.mocked(UploadsController.getUploadSession);

function makeFile(name = "a.png", lastModified = 111): File {
  return new File([new Uint8Array(10)], name, { lastModified, type: "image/png" });
}

function makeSession(): UploadSession {
  return {
    uploadId: "upl-1",
    kind: "image",
    fileName: "a.png",
    size: 10,
    chunkSize: 4,
    chunkCount: 3,
    uploadedIndexes: []
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("chunked-upload-resume", () => {
  test("指纹命中:save 后 findResumableSession 按 uploadId 查会话并返回", async () => {
    const file = makeFile();
    const session = makeSession();
    mockedGetSession.mockResolvedValue(session);

    saveResumableUploadId(file, "upl-1");
    const found = await findResumableSession(file);

    expect(mockedGetSession).toHaveBeenCalledWith("upl-1");
    expect(found).toEqual(session);
  });

  test("无指纹记录:不触网,返回 null", async () => {
    const found = await findResumableSession(makeFile());
    expect(found).toBeNull();
    expect(mockedGetSession).not.toHaveBeenCalled();
  });

  test("指纹由 fileName+size+lastModified 组成:同名文件不同指纹不命中", async () => {
    saveResumableUploadId(makeFile("a.png", 111), "upl-1");
    expect(await findResumableSession(makeFile("a.png", 222))).toBeNull();
    expect(await findResumableSession(makeFile("b.png", 111))).toBeNull();
  });

  test("会话已被服务端清理(查询失败):清除指纹记录并按全新上传处理", async () => {
    const file = makeFile();
    mockedGetSession.mockRejectedValue(new Error("404"));
    saveResumableUploadId(file, "upl-1");

    const found = await findResumableSession(file);

    expect(found).toBeNull();
    // 记录已清除:再次查询直接为 null
    expect(await findResumableSession(file)).toBeNull();
    expect(mockedGetSession).toHaveBeenCalledTimes(1);
  });

  test("clearResumableUploadId 清除指纹", async () => {
    const file = makeFile();
    saveResumableUploadId(file, "upl-1");
    clearResumableUploadId(file);
    expect(await findResumableSession(file)).toBeNull();
  });

  test("localStorage 抛异常(隐私模式)不向上冒泡", async () => {
    const file = makeFile();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota / privacy mode");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("privacy mode");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("privacy mode");
    });

    expect(() => saveResumableUploadId(file, "upl-1")).not.toThrow();
    expect(() => clearResumableUploadId(file)).not.toThrow();
    await expect(findResumableSession(file)).resolves.toBeNull();
  });
});
