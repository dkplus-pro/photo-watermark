import type { DownloadBlob } from "./frame/types";

/**
 * 下载触发(导出链最后一公里,决策 D5:整批产物压成一个 zip 后一次 anchor 下载)。
 * 「权限缺失 / 网络失败」两类边界在这里不适用:本模块不发请求、不读权限,
 * 只做一次本地 anchor 点击。
 */

/**
 * object URL 的延迟回收时长(毫秒)。
 *
 * 必须延迟、不能点完就 revoke:点击只是把下载交给浏览器的下载管理器,
 * 大 Blob(几百 MB 的导出 zip)此刻还在从内存往磁盘写。立即回收会让
 * Firefox/Safari 断流,现象是「下载已取消」或落地一个 0 字节文件。
 * 30s 取参考实现同值,足够慢速磁盘与移动端写完。
 */
export const OBJECT_URL_REVOKE_DELAY = 30_000;

/**
 * 延迟回收 object URL。
 * 具名导出供单测与预览逻辑(`useObjectUrl` 一类)复用;`downloadBlob` 内部也走它。
 * 定时器句柄刻意不持有:文档卸载时浏览器会连带回收计时器与 URL,不需要手动 clear。
 */
export const revokeObjectUrlLater = (
  url: string,
  delayMs: number = OBJECT_URL_REVOKE_DELAY
): void => {
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, delayMs);
};

/** 把 anchor 挂进文档。返回 false 表示当前文档根本没有可挂载的父节点。 */
const attachAnchor = (anchor: HTMLAnchorElement): boolean => {
  try {
    // document.body 在极端时机(脚本先于 body 解析、SSR 残留)会是 null,退回 documentElement。
    const parent = document.body ?? document.documentElement;
    if (!parent) {
      return false;
    }
    parent.appendChild(anchor);
    return true;
  } catch {
    return false;
  }
};

/**
 * 触发一次浏览器下载。
 *
 * `blob.size === 0` 也照常触发:空 zip 由上游流水线保证不会出现,
 * 工具层不做业务校验,免得把「该不该下载」的判断分散到两处。
 */
export const downloadBlob: DownloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;

  if (!attachAnchor(anchor)) {
    // 挂不上就静默返回:下载失败由 UI 层的「导出完成/导出失败」文案兜底,
    // 工具层抛错会把整条导出流程的 catch 分支搅浑(用户看到的是技术栈而不是结果)。
    // 此时没有下载在途,可以立刻回收 URL。
    URL.revokeObjectURL(url);
    return;
  }

  try {
    // anchor 必须先入 DOM 才会生效:Firefox 对未挂载的 anchor 调用 click() 直接忽略,
    // 不弹保存框也不写下载记录。这是本函数唯一容易被写错的点,改动前请先跑单测。
    anchor.click();
  } finally {
    anchor.remove();
  }

  revokeObjectUrlLater(url);
};
