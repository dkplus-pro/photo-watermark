import { useEffect, useState } from "react";

// 移动端断点:与 Arco Grid 的 md(768px)对齐,< 768px 视为移动端(断点约定见 docs/site.md)。
const MOBILE_QUERY = "(max-width: 767px)";

// 是否处于移动端断点。
// SSR 期间 matchMedia 不可用,固定按桌面(false)渲染并在挂载后同步真实断点,
// 保证服务端与客户端首帧一致、无 hydration 告警(见 docs/site.md「SSR 注意事项」)。
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return isMobile;
}
