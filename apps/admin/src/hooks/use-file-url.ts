import { useAuthStore } from "../store/auth";
import { useEffect, useState } from "react";

// 媒体展示地址:OSS 记录直接返回 CDN 直链(directUrl,公开可读);
// local 记录没有直链,文件内容端点(/api/admin/files/{id}/content,契约自带前缀)
// 需要 Bearer token,<img>/<video> 的 src 无法携带请求头,因此用 fetch 取 blob
// 再生成 objectURL 供媒体组件使用(用完即释放)。
export function useFileURL(fileId: number | null | undefined, directUrl?: string | null) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId || directUrl) {
      setBlobUrl(null);
      return;
    }
    let revoked = false;
    let objectURL: string | null = null;

    const token = useAuthStore.getState().token;
    fetch(`/api/admin/files/${fileId}/content`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`load file ${fileId}: ${res.status}`);
        }
        return res.blob();
      })
      .then((blob) => {
        if (revoked) {
          return;
        }
        objectURL = URL.createObjectURL(blob);
        setBlobUrl(objectURL);
      })
      .catch(() => {
        if (!revoked) {
          setBlobUrl(null);
        }
      });

    return () => {
      revoked = true;
      if (objectURL) {
        URL.revokeObjectURL(objectURL);
      }
    };
  }, [fileId, directUrl]);

  return directUrl || blobUrl;
}
