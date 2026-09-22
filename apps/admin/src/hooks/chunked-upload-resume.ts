import { UploadsController } from "../api/controllers.gen";
import type { UploadSession } from "../api/generated/cMSAdminAPI.schemas";

// 分片上传的断点续传会话识别,与 use-chunked-upload 配套(阶段 14)。
// localStorage 键 = 文件指纹(fileName+size+lastModified),值 = 未完成 uploadId;
// 完成或取消后清除,失败保留以便下次续传。
const RESUME_STORAGE_PREFIX = "admin.chunkedUpload.";

function resumeStorageKey(file: File): string {
  return (
    RESUME_STORAGE_PREFIX + encodeURIComponent(`${file.name}:${file.size}:${file.lastModified}`)
  );
}

function readResumableUploadId(file: File): string | null {
  // localStorage 抛异常(隐私模式等)时按无记录处理,不向上冒泡
  try {
    return localStorage.getItem(resumeStorageKey(file));
  } catch {
    return null;
  }
}

export function saveResumableUploadId(file: File, uploadId: string): void {
  // 写入失败(隐私模式等)只影响断点续传,不得中断上传主流程
  try {
    localStorage.setItem(resumeStorageKey(file), uploadId);
  } catch {
    return;
  }
}

export function clearResumableUploadId(file: File): void {
  try {
    localStorage.removeItem(resumeStorageKey(file));
  } catch {
    return;
  }
}

// 识别该文件是否有可续传的未完成会话:有指纹记录则查会话状态;会话已被服务端清理
// (超 24h)或不可访问时清除记录,按全新上传处理。
export async function findResumableSession(file: File): Promise<UploadSession | null> {
  const uploadId = readResumableUploadId(file);
  if (!uploadId) {
    return null;
  }
  try {
    return await UploadsController.getUploadSession(uploadId);
  } catch {
    clearResumableUploadId(file);
    return null;
  }
}

// "重新上传"的前置:中止旧会话并清除指纹记录,之后按全新上传发起 init;
// 会话已不存在时报错由 client.ts 拦截器提示,这里吞掉以保证流程继续。
export async function discardResumableSession(file: File, session: UploadSession): Promise<void> {
  clearResumableUploadId(file);
  await UploadsController.abortUpload(session.uploadId).catch(() => undefined);
}
