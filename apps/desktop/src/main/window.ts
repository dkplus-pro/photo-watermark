/**
 * 窗口创建 + 安全基线 + 状态持久化:
 * - will-navigate 白名单:自身来源(dev server)与 DESKTOP_NAV_ALLOWLIST 显式配置,其余拦截;
 * - setWindowOpenHandler:拒绝一切 window.open 新窗口,白名单内 http(s) 外链交系统浏览器;
 * - 权限请求默认拒绝(session.setPermissionRequestHandler):壳层不预授权任何浏览器能力;
 * - 窗口宽高位置经 window-state 持久化,坐标恢复前校验仍落在已接显示器内。
 * watchdog 由 index.ts 装配(见装配顺序),本模块不负责崩溃重载。
 */
import { BrowserWindow, screen, session, shell } from "electron";
import { join } from "node:path";
import { isUrlAllowed } from "./config";
import type { DesktopConfig } from "./config";
import { logger } from "./logger";
import { loadWindowState, persistWindowState } from "./window-state";
import type { WindowState } from "./window-state";

/** 校验持久化坐标仍落在某个已接显示器内,防止拔掉显示器后窗口跑到屏幕外。 */
function resolveWindowPosition(state: WindowState): { x?: number; y?: number } {
  const { x, y } = state;
  if (x == null || y == null) return {};
  const onScreen = screen.getAllDisplays().some(({ bounds }) => {
    return (
      x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height
    );
  });
  return onScreen ? { x, y } : {};
}

export function createWindow(config: DesktopConfig): BrowserWindow {
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...resolveWindowPosition(state),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js")
    }
  });

  // 权限请求默认拒绝:debug 记录便于放开时定位,避免 dev 下每次请求刷屏。
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    logger.debug(`permission 请求被默认拒绝:${permission}`);
    callback(false);
  });

  // will-navigate 白名单:loadURL/loadFile 等程序化导航不触发本事件,只拦页面内自发导航。
  win.webContents.on("will-navigate", (event, url) => {
    if (isUrlAllowed(url, config.navAllowlist, config.selfOrigin)) return;
    event.preventDefault();
    logger.warn(`will-navigate 拦截非白名单导航:${url}`);
  });

  // 外链策略:拒绝一切新窗口;白名单内 http(s) 交给系统浏览器。
  win.webContents.setWindowOpenHandler((details) => {
    if (isUrlAllowed(details.url, config.navAllowlist, config.selfOrigin)) {
      void shell.openExternal(details.url);
    } else {
      logger.warn(`setWindowOpenHandler 拦截非白名单外链:${details.url}`);
    }
    return { action: "deny" };
  });

  win.on("ready-to-show", () => {
    win.show();
  });

  win.on("close", () => {
    persistWindowState(win);
  });

  // electron-vite dev 注入渲染层 dev server 地址;生产加载 out/renderer 构建产物。
  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}
