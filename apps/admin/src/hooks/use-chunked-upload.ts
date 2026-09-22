import { isCancel } from "axios";
import range from "lodash/range";
import { useCallback, useEffect, useRef, useState } from "react";

import { axiosInstance } from "../api/client";
import { UploadsController } from "../api/controllers.gen";
import type {
  UploadedMedia,
  UploadSession,
  UploadSessionKind
} from "../api/generated/cMSAdminAPI.schemas";
import { clearResumableUploadId, saveResumableUploadId } from "./chunked-upload-resume";

// 分片上传策略(阶段 14 方案):并发 3 片,单片失败自动重试 2 次;
// 分片大小以 init 返回的 chunkSize 为准(服务端 5MB),不在前端约定。
const CHUNK_CONCURRENCY = 3;
const CHUNK_MAX_RETRIES = 2;
const CHUNK_RETRY_DELAY_MS = 1000;

// 按会话分片规格折算已传字节:最后一片可小于 chunkSize,其余单片恒为 chunkSize。
function uploadedBytesOf(
  totalBytes: number,
  session: UploadSession,
  uploaded: Set<number>
): number {
  const lastIndex = session.chunkCount - 1;
  let bytes = 0;
  for (const index of uploaded) {
    bytes += index === lastIndex ? totalBytes - lastIndex * session.chunkSize : session.chunkSize;
  }
  return bytes;
}

// 断点续传会话指纹存取与识别见 chunked-upload-resume.ts。

export type ChunkedUploadStatus =
  | "idle" // 未开始
  | "preparing" // 初始化会话 / 续传对账中
  | "uploading" // 分片上传中
  | "paused" // 已暂停
  | "completed" // complete 成功
  | "failed" // 重试耗尽或合并失败(指纹保留,可续传)
  | "cancelled"; // 用户取消(会话已中止,指纹已清除)

export interface ChunkedUploadState {
  status: ChunkedUploadStatus;
  fileName: string;
  totalBytes: number;
  uploadedBytes: number;
}

// 大文件分片上传:init → 并发 3 片 PUT(单片失败重试 2 次)→ complete。
// 暴露总进度(已传字节/总字节)与暂停/继续/取消;进度为瞬时状态,由 hook 内部 state 管理。
export function useChunkedUpload(kind: UploadSessionKind) {
  const [state, setState] = useState<ChunkedUploadState>({
    status: "idle",
    fileName: "",
    totalBytes: 0,
    uploadedBytes: 0
  });
  const fileRef = useRef<File | null>(null);
  const sessionRef = useRef<UploadSession | null>(null);
  const uploadedIndexesRef = useRef<Set<number>>(new Set());
  const pausedRef = useRef(false);
  const inFlightRef = useRef<Map<number, AbortController>>(new Map());
  // 代次计数:取消/重新开始后使仍在收尾的旧异步流程(对账、complete)整体失效
  const generationRef = useRef(0);

  const abortInFlight = useCallback(() => {
    for (const controller of inFlightRef.current.values()) {
      controller.abort();
    }
    inFlightRef.current.clear();
  }, []);

  const applyChunkProgress = useCallback(() => {
    setState((prev) => {
      const session = sessionRef.current;
      if (!session) {
        return prev;
      }
      return {
        ...prev,
        uploadedBytes: uploadedBytesOf(prev.totalBytes, session, uploadedIndexesRef.current)
      };
    });
  }, []);

  // 单片上传(octet-stream):重试 2 次、线性退避;被暂停/取消中断不算失败,
  // 分片幂等覆盖,续传时重传即可。生成函数不透传 AbortSignal(暂停/取消需要中断
  // 在途请求),这里按契约路径复用 client.ts 的 axiosInstance 直发。
  const uploadOneChunk = useCallback(
    async (generation: number, index: number): Promise<boolean> => {
      const file = fileRef.current;
      const session = sessionRef.current;
      if (!file || !session) {
        return false;
      }
      const offset = index * session.chunkSize;
      const blob = file.slice(offset, Math.min(offset + session.chunkSize, file.size));
      for (let attempt = 0; attempt <= CHUNK_MAX_RETRIES; attempt += 1) {
        if (pausedRef.current || generationRef.current !== generation) {
          return false;
        }
        const controller = new AbortController();
        inFlightRef.current.set(index, controller);
        try {
          await axiosInstance.request({
            url: `/api/admin/uploads/${session.uploadId}/chunks/${index}`,
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            data: blob,
            signal: controller.signal
          });
          inFlightRef.current.delete(index);
          uploadedIndexesRef.current.add(index);
          applyChunkProgress();
          return true;
        } catch (error) {
          inFlightRef.current.delete(index);
          if (isCancel(error) || pausedRef.current || generationRef.current !== generation) {
            return false;
          }
          if (attempt >= CHUNK_MAX_RETRIES) {
            return false; // 重试耗尽,由调用方统一置为 failed
          }
          await new Promise((resolve) => {
            setTimeout(resolve, CHUNK_RETRY_DELAY_MS * (attempt + 1));
          });
        }
      }
      return false;
    },
    [applyChunkProgress]
  );

  // 工作池:并发 CHUNK_CONCURRENCY 个 worker 消费未上传分片队列。
  const runPendingChunks = useCallback(
    async (generation: number): Promise<void> => {
      const session = sessionRef.current;
      if (!session) return;
      const pending = range(session.chunkCount).filter(
        (index) => !uploadedIndexesRef.current.has(index)
      );
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (
          !pausedRef.current &&
          generationRef.current === generation &&
          cursor < pending.length
        ) {
          const index = pending[cursor];
          cursor += 1;
          await uploadOneChunk(generation, index);
        }
      };
      const workerCount = Math.min(CHUNK_CONCURRENCY, pending.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    },
    [uploadOneChunk]
  );

  // 分片队列排空后的收尾:暂停 → paused;未齐 → failed;齐全 → complete 合并。
  const settleAfterChunks = useCallback(
    async (generation: number): Promise<UploadedMedia | null> => {
      if (generationRef.current !== generation) {
        return null; // 已被取消或重新开始
      }
      const file = fileRef.current;
      const session = sessionRef.current;
      if (!file || !session) return null;
      if (pausedRef.current) {
        setState((prev) => (prev.status === "uploading" ? { ...prev, status: "paused" } : prev));
        return null;
      }
      if (uploadedIndexesRef.current.size < session.chunkCount) {
        setState((prev) => ({ ...prev, status: "failed" }));
        return null;
      }
      try {
        const media = await UploadsController.completeUpload(session.uploadId);
        if (generationRef.current !== generation) {
          return null;
        }
        clearResumableUploadId(file);
        setState((prev) => ({ ...prev, status: "completed", uploadedBytes: prev.totalBytes }));
        return media;
      } catch {
        // 合并失败(分片被服务端清理等):指纹保留,下次同一文件可续传后重试 complete
        setState((prev) => ({ ...prev, status: "failed" }));
        return null;
      }
    },
    []
  );

  const start = useCallback(
    async (
      file: File,
      // groupId:init 时固化,上传中修改分组不影响进行中的会话;resumeSession:断点续传时跳过 init
      options: { groupId?: number; resumeSession?: UploadSession } = {}
    ): Promise<UploadedMedia | null> => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      pausedRef.current = false;
      inFlightRef.current.clear();
      uploadedIndexesRef.current = new Set();
      fileRef.current = file;
      setState({
        status: "preparing",
        fileName: file.name,
        totalBytes: file.size,
        uploadedBytes: 0
      });
      try {
        const initUpload =
          kind === "image" ? UploadsController.initImageUpload : UploadsController.initVideoUpload;
        const session =
          options.resumeSession ??
          (await initUpload({ fileName: file.name, size: file.size, groupId: options.groupId }));
        if (generationRef.current !== generation) {
          return null; // 等待 init 期间被取消/重新开始
        }
        sessionRef.current = session;
        uploadedIndexesRef.current = new Set(session.uploadedIndexes);
        saveResumableUploadId(file, session.uploadId);
        applyChunkProgress();
        setState((prev) => ({ ...prev, status: "uploading" }));
        await runPendingChunks(generation);
        return await settleAfterChunks(generation);
      } catch {
        // init 失败:提示由 client.ts 拦截器弹出,这里只落状态
        if (generationRef.current === generation) {
          setState((prev) => ({ ...prev, status: "failed" }));
        }
        return null;
      }
    },
    [applyChunkProgress, kind, runPendingChunks, settleAfterChunks]
  );

  // 暂停:中止全部在途分片请求,worker 感知后退出。
  const pause = useCallback(() => {
    pausedRef.current = true;
    abortInFlight();
    setState((prev) => (prev.status === "uploading" ? { ...prev, status: "paused" } : prev));
  }, [abortInFlight]);

  // 继续:先与会话状态对账(暂停前在途请求可能已落盘),再从缺失分片继续。
  const resume = useCallback(async (): Promise<void> => {
    const generation = generationRef.current;
    const session = sessionRef.current;
    if (!session || generation === 0) return;
    pausedRef.current = false;
    setState((prev) => (prev.status === "paused" ? { ...prev, status: "uploading" } : prev));
    try {
      const fresh = await UploadsController.getUploadSession(session.uploadId);
      if (generationRef.current !== generation) {
        return; // 对账期间被取消/重新开始
      }
      sessionRef.current = fresh;
      uploadedIndexesRef.current = new Set(fresh.uploadedIndexes);
      applyChunkProgress();
    } catch {
      // 对账失败不阻塞续传,按本地已传集合继续(分片幂等覆盖)
    }
    await runPendingChunks(generation);
    await settleAfterChunks(generation);
  }, [applyChunkProgress, runPendingChunks, settleAfterChunks]);

  // 取消:中止在途请求 + abort 服务端会话 + 清除指纹记录,状态复位为 cancelled。
  const cancel = useCallback(() => {
    const session = sessionRef.current;
    generationRef.current += 1;
    pausedRef.current = false;
    abortInFlight();
    if (fileRef.current) {
      clearResumableUploadId(fileRef.current);
    }
    if (session) {
      // 会话已不存在(服务端清理)时报错由拦截器提示,这里吞掉避免二次打扰
      void UploadsController.abortUpload(session.uploadId).catch(() => undefined);
    }
    fileRef.current = null;
    sessionRef.current = null;
    uploadedIndexesRef.current = new Set();
    setState((prev) => ({ ...prev, status: "cancelled" }));
  }, [abortInFlight]);

  // 组件卸载(如关闭上传弹窗)时终止上传并中断在途请求,避免不可见的僵尸请求持续占用带宽。
  useEffect(() => {
    return () => {
      cancel();
    };
  }, [cancel]);

  return { state, start, pause, resume, cancel };
}
