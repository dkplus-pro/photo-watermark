/**
 * electron-log 薄封装(依赖收口:全仓库只允许本文件 import electron-log,
 * 其余模块一律 import 这里;D4 收口统一安装依赖前,本文件是唯一的类型缺口)。
 * - 文件滚动:electron-log 默认写 userData/logs/main.log,超 maxSize 轮转为 main.old.log,这里设 5MB;
 * - 级别坑:electron-log v5 两个 transport 的 level 必须用 DESKTOP_LOG_LEVEL 显式压住,
 *   否则默认级别会放量(verbose/silly),dev 控制台出现全量噪音;DESKTOP_LOG_LEVEL
 *   不在 config.LogLevel 枚举内时回落 info(config.ts 已归一化)。
 */
import electronLog from "electron-log/main";

import type { DesktopConfig, LogLevel } from "./config";

/**
 * 对 electron-log 做最小面类型收敛,屏蔽其内部类型差异(v4/v5 级别枚举不完全一致)。
 * electron-log v5 两个 transport 均有 level/maxSize 与 debug/warn 别名方法,收敛面安全。
 */
interface MainLogger {
  transports: {
    file: { level: string; maxSize: number };
    console: { level: string };
  };
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

const log = electronLog as unknown as MainLogger;

/** 日志级别 → electron-log 级别名(注意 electron-log 用 "warning" 而非 "warn")。 */
const LEVEL_MAP: Record<LogLevel, string> = {
  debug: "debug",
  info: "info",
  warn: "warning",
  error: "error"
};

export function initLogger(config: DesktopConfig): void {
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.file.level = LEVEL_MAP[config.logLevel];
  log.transports.console.level = LEVEL_MAP[config.logLevel];
}

export const logger = {
  debug(message: string, ...meta: unknown[]): void {
    log.debug(message, ...meta);
  },
  info(message: string, ...meta: unknown[]): void {
    log.info(message, ...meta);
  },
  warn(message: string, ...meta: unknown[]): void {
    log.warn(message, ...meta);
  },
  error(message: string, ...meta: unknown[]): void {
    log.error(message, ...meta);
  }
};
