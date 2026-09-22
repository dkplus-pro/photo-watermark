/**
 * 窗口宽高位置持久化:userData/window-state.json。
 * 读时消毒:非法值回落默认尺寸(1200x800)、非整数坐标丢弃;恢复前由 window.ts 校验
 * 坐标仍落在已接显示器内,避免拔掉显示器后窗口跑到屏幕外。写时机为窗口 close
 * (应用退出也会触发),强杀场景可能丢最后一帧状态,属可接受取舍。
 */
import { app } from "electron";
import type { BrowserWindow } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger";

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;
const STATE_FILE = "window-state.json";

export interface WindowState {
  width: number;
  height: number;
  /** 上次窗口左上角坐标;文件缺该字段或非法时为 null(交给系统默认摆位) */
  x: number | null;
  y: number | null;
}

function toPositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function toNullableInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function loadWindowState(): WindowState {
  const file = join(app.getPath("userData"), STATE_FILE);
  if (!existsSync(file)) {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, x: null, y: null };
  }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    return {
      width: toPositiveInt(raw["width"], DEFAULT_WIDTH),
      height: toPositiveInt(raw["height"], DEFAULT_HEIGHT),
      x: toNullableInt(raw["x"]),
      y: toNullableInt(raw["y"])
    };
  } catch (error) {
    logger.warn("window-state 读取失败,使用默认尺寸", error);
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, x: null, y: null };
  }
}

export function persistWindowState(win: BrowserWindow): void {
  try {
    const bounds = win.getBounds();
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y
    };
    writeFileSync(join(app.getPath("userData"), STATE_FILE), JSON.stringify(state), "utf8");
  } catch (error) {
    logger.warn("window-state 写入失败", error);
  }
}
