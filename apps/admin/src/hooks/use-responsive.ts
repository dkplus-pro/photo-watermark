import { configResponsive, useResponsive } from "ahooks";

import { DESKTOP_BREAKPOINT, MOBILE_BREAKPOINT } from "../constants";

// 桌面断点从 constants 单一事实源取(与相框列表的栅格列数共用),此处再导出一次,
// 让只关心壳层交互的消费方不必越过 hooks 层。
export { DESKTOP_BREAKPOINT };

// ahooks 的断点语义是 min-width:info[key] = window.innerWidth >= config[key]。
// 模块顶层配置一次全站断点表(hook 内部是模块级单例,重复配置会互相覆盖)。
configResponsive({
  atLeastTablet: MOBILE_BREAKPOINT,
  atLeastDesktop: DESKTOP_BREAKPOINT
});

// ResponsiveInfo 的类型是 Record<string, boolean>,但断点表之外的键运行期为 undefined,
// 故一律用 Boolean() 兜住,避免 `!undefined` 之类的隐式假设散落到调用方。
function readAtLeastTablet(info: ReturnType<typeof useResponsive>): boolean {
  return Boolean(info.atLeastTablet);
}

function readAtLeastDesktop(info: ReturnType<typeof useResponsive>): boolean {
  return Boolean(info.atLeastDesktop);
}

/** 是否处于移动端(< 768px):壳层在此断点把 Sider 换成 Drawer。 */
export function useIsMobile(): boolean {
  return !readAtLeastTablet(useResponsive());
}

/** 是否处于平板区间(768px ≤ 宽 < 1024px)。 */
export function useIsTablet(): boolean {
  const info = useResponsive();
  return readAtLeastTablet(info) && !readAtLeastDesktop(info);
}
