/**
 * 暗色跟随系统(配置坑,docs/desktop-shell-plan.md §3):经 window.desktop.theme.get()
 * 读取主进程 nativeTheme.shouldUseDarkColors(桥缺失时降级浏览器 prefers-color-scheme
 * 媒体查询),并把结果同步到 body 的 arco-theme 属性(Arco 2.x 官方暗色开关)。
 *
 * 已知边界(坑,接通留业务阶段):按需样式下未引入全量 arco.dark.css,Arco 组件的
 * 暗色变量暂不生效,本 hook 先保证 body 属性与跟随逻辑就位;接通方案见
 * electron.vite.config.ts 的 enableArcoImportPlugin 回退注释。
 */
import { useEffect, useState } from "react";

import { getDesktopBridge } from "../sdk/bridge";

/** 返回当前是否暗色(系统判定结果;桥缺失时走媒体查询)。 */
export function useSystemTheme(): boolean {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    let active = true;
    const bridge = getDesktopBridge();
    if (bridge?.theme) {
      bridge.theme
        .get()
        .then((info) => {
          if (active) setDark(Boolean(info?.dark));
        })
        .catch(() => {
          // 查询失败保持亮色默认。
        });
      return () => {
        active = false;
      };
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(media.matches);
    const onChange = (event: MediaQueryListEvent) => setDark(event.matches);
    media.addEventListener("change", onChange);
    return () => {
      active = false;
      media.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    if (dark) {
      document.body.setAttribute("arco-theme", "dark");
    } else {
      document.body.removeAttribute("arco-theme");
    }
  }, [dark]);

  return dark;
}
