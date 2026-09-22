import { useMemoizedFn } from "ahooks";
import { useEffect, useState } from "react";

/**
 * Blob/File → object URL 的生命周期管理。
 *
 * 本站一次挂几十张本地图片预览,`URL.createObjectURL` 生成的 URL 指向浏览器内存里的
 * Blob 副本,不 revoke 就是确定的内存泄漏(且不受 GC 回收)。因此「谁创建谁释放」:
 * source 换引用与组件卸载两条路径都必须 revoke,这条是 hook 存在的唯一理由。
 *
 * 依赖只按引用相等(Object.is)比较:Blob 不可 JSON 序列化,也没有可比的稳定身份字段。
 */
export interface ObjectUrlState {
  url: string | null;
}

/** 生成失败(隐私模式、配额耗尽)时返回 null 而不是抛错 —— 预览坏了不该把表单炸掉。 */
const createObjectUrl = (source: Blob): string | null => {
  try {
    return URL.createObjectURL(source);
  } catch {
    return null;
  }
};

const revokeObjectUrl = (url: string): void => {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // 已被释放或不支持:没有可补救的动作,静默即可。
  }
};

/**
 * 传 null/undefined 得到 null,且完全不触碰 createObjectURL。
 * 入参类型刻意放宽到含 undefined:调用侧常是 `entries[0]?.file` 这类可选取值。
 */
export function useObjectUrl(source: Blob | File | null | undefined): string | null {
  // 用对象持有状态并做同值短路:同一个 URL 重复 set 不产生额外渲染。
  const [state, setState] = useState<ObjectUrlState>({ url: null });
  const releaseUrl = useMemoizedFn(revokeObjectUrl);

  useEffect(() => {
    if (!source) {
      setState((prev) => (prev.url === null ? prev : { url: null }));
      return;
    }
    // 空串按失败处理:某些实现「不支持」时返回空字符串而非抛错,它不是可用的 object URL。
    const url = createObjectUrl(source) || null;
    setState((prev) => (prev.url === url ? prev : { url }));
    if (!url) return;
    return () => {
      releaseUrl(url);
    };
  }, [source, releaseUrl]);

  return state.url;
}
