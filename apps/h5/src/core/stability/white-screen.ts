// core/stability/white-screen.ts:白屏检测(方案 §3「稳定性」)。
// 挂载超时后根节点仍无可见内容 → 经 core/monitor captureMessage 上报(kind=white_screen)。
// 仅上报不阻断:检测不触碰 DOM、不跳转;误报缓解 = 超时阈值 + 阈值可配(见 DEFAULT 注释)。
import { getReporter } from "../monitor";

import type { WhiteScreenCheckOptions } from "./index";

/**
 * 默认挂载超时 3s。
 * 配置坑:当前由装配方(阶段 3 收口)传参;如需部署期可调,收口进 src/config/ 槽位
 * (env/feature 类型化读取),禁止散落 process.env 直读。
 */
export const DEFAULT_WHITE_SCREEN_TIMEOUT_MS = 3000;

// 默认根节点选择器:Modern.js 客户端挂载点。
const DEFAULT_ROOT_SELECTOR = "#root";

// 自渲染元素:无文本子节点也算内容(纯图/视频活动页不算白屏,防误报)。
const SELF_RENDERING_TAGS = new Set(["IMG", "VIDEO", "CANVAS", "SVG", "IFRAME", "OBJECT", "EMBED"]);

function isHiddenElement(el: Element): boolean {
  // jsdom 只解析内联样式(测试经 element.style 注入);浏览器端走级联样式。
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return false;
  }
  const style = window.getComputedStyle(el);
  return style.display === "none" || style.visibility === "hidden";
}

function hasVisibleContent(el: Element): boolean {
  if (isHiddenElement(el)) {
    return false;
  }
  if (SELF_RENDERING_TAGS.has(el.tagName)) {
    return true;
  }
  for (const node of Array.from(el.childNodes)) {
    // nodeType 3 = TEXT_NODE:非空白文本即内容。
    if (node.nodeType === 3 && (node.textContent ?? "").trim() !== "") {
      return true;
    }
    // nodeType 1 = ELEMENT_NODE:递归找可见内容。
    if (node.nodeType === 1 && hasVisibleContent(node as Element)) {
      return true;
    }
  }
  return false;
}

/**
 * 白屏判定纯函数(可单测):根节点缺失或子树无任何可见内容(含子节点全隐藏)→ 视为白屏。
 */
export function isRootEmpty(root: Element | null): boolean {
  if (!root) {
    return true;
  }
  return !hasVisibleContent(root);
}

/**
 * 启动白屏检测:timeoutMs 后检查 rootSelector 指向的根节点,判白屏仅上报 captureMessage。
 * SSR 安全:服务端无 window,直接返回 no-op 取消函数(node 分支有单测覆盖)。
 * 返回取消函数:定时器触发前可取消(路由切换/卸载时用),触发后取消为幂等 no-op。
 */
export function startWhiteScreenCheck(options?: Partial<WhiteScreenCheckOptions>): () => void {
  const rootSelector = options?.rootSelector ?? DEFAULT_ROOT_SELECTOR;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_WHITE_SCREEN_TIMEOUT_MS;

  if (typeof window === "undefined") {
    return () => undefined;
  }

  const scheduleTimer =
    options?.scheduleTimer ??
    ((callback: () => void, ms: number) => window.setTimeout(callback, ms));
  const cancelTimer =
    options?.cancelTimer ?? ((handle: unknown) => window.clearTimeout(handle as number));

  let fired = false;
  const handle = scheduleTimer(() => {
    fired = true;
    const root = document.querySelector(rootSelector);
    if (isRootEmpty(root)) {
      getReporter().captureMessage({
        kind: "white_screen",
        message: "页面挂载后超时仍为白屏(根节点无可见内容)",
        extra: { rootSelector, timeoutMs }
      });
    }
  }, timeoutMs);

  return () => {
    if (!fired) {
      cancelTimer(handle);
    }
  };
}
