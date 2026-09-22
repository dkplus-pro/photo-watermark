/**
 * 主进程配置:全仓库唯一读取 process.env.DESKTOP_* 的模块,配置坑集中于此
 * (清单见 docs/desktop-shell-plan.md §3 与 apps/desktop/.env.example)。
 * 缺省策略(沿用 site RUM 模式:缺配置即不初始化、返回可断言的值):
 * - REPORT_ENDPOINT/REPORT_PID 缺任一 → transport 整条管道不初始化(dev 默认关);
 * - CRASH_SUBMIT_URL 缺省 → crashReporter 只本地存 dump 不上传;
 * - NAV_ALLOWLIST 缺省 → 仅放行自身来源(dev 下为 electron-vite 注入的渲染层 dev server 地址)。
 */

export interface DesktopConfig {
  /** 监控/埋点统一上报 endpoint(与 reportPid 成对,缺任一 transport 不初始化) */
  reportEndpoint: string | null;
  /** 上报标识 */
  reportPid: string | null;
  /** 采样率 0~1,默认 1(全量) */
  reportSampleRate: number;
  /** crashReporter submitURL(缺省 null → uploadToServer=false 只本地存 dump) */
  crashSubmitUrl: string | null;
  /** 日志级别,默认 info */
  logLevel: LogLevel;
  /** 更新服务坑(NullUpdater 不消费,仅提示;更新接入点见 updater.ts) */
  updateUrl: string | null;
  /** will-navigate / openExternal 白名单(逗号分隔;条目端口为 * 时按 host 通配) */
  navAllowlist: string[];
  /** 自身来源:dev 为渲染层 dev server origin,生产 file:// 加载无 origin 恒为 null */
  selfOrigin: string | null;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function readEnv(key: string): string | null {
  const value = process.env[key];
  return value != null && value.trim() !== "" ? value.trim() : null;
}

function toOrigin(rawUrl: string | null): string | null {
  if (rawUrl == null) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

function toLogLevel(raw: string | null): LogLevel {
  return raw != null && (LOG_LEVELS as readonly string[]).includes(raw)
    ? (raw as LogLevel)
    : "info";
}

function toSampleRate(raw: string | null): number {
  if (raw == null) return 1;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

export function loadDesktopConfig(): DesktopConfig {
  const allowlistRaw = readEnv("DESKTOP_NAV_ALLOWLIST");
  return {
    reportEndpoint: readEnv("DESKTOP_REPORT_ENDPOINT"),
    reportPid: readEnv("DESKTOP_REPORT_PID"),
    reportSampleRate: toSampleRate(readEnv("DESKTOP_REPORT_SAMPLE_RATE")),
    crashSubmitUrl: readEnv("DESKTOP_CRASH_SUBMIT_URL"),
    logLevel: toLogLevel(readEnv("DESKTOP_LOG_LEVEL")),
    updateUrl: readEnv("DESKTOP_UPDATE_URL"),
    navAllowlist:
      allowlistRaw == null
        ? []
        : allowlistRaw
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry !== ""),
    selfOrigin: toOrigin(readEnv("ELECTRON_RENDERER_URL"))
  };
}

/**
 * 白名单匹配:非 http(s) 一律拒绝;selfOrigin 恒放行;条目形如 `http://localhost:*`
 * 时端口通配(仅比较 protocol+hostname),否则整 origin 精确匹配。非法条目直接忽略。
 */
export function isUrlAllowed(
  rawUrl: string,
  allowlist: string[],
  selfOrigin: string | null
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  if (selfOrigin != null && url.origin === selfOrigin) {
    return true;
  }
  return allowlist.some((entry) => {
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      return false;
    }
    if (parsed.protocol !== url.protocol) return false;
    if (parsed.port === "*") return parsed.hostname === url.hostname;
    return parsed.origin === url.origin;
  });
}
