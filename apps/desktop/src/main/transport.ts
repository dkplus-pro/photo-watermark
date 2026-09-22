/**
 * 上报管道(监控/埋点统一通道):渲染层与主进程事件都不直连 endpoint,统一进这里批量上报。
 * - 初始化条件:DESKTOP_REPORT_ENDPOINT 与 DESKTOP_REPORT_PID 缺任一 → 整条管道不初始化
 *   (dev 默认关,initTransport 返回 false 供测试断言,沿用 site RUM 模式);
 * - 批量:内存队列满 10 条或 5s 定时器触发 flush;
 * - 采样:DESKTOP_REPORT_SAMPLE_RATE(0~1)在入队前逐条判定,未采样事件不占内存与磁盘;
 * - 溢出:flush 失败(网络等)把队列追加落盘 userData/report-queue.jsonl,下次启动重发;
 * - 传输:electron net.fetch POST 唯一 endpoint,不引第三方 SDK、不经渲染层。
 */
import { app, net } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DesktopConfig } from "./config";
import { logger } from "./logger";

export type ReportKind = "track" | "error";

export interface ReportEntry {
  kind: ReportKind;
  /** 上报标识,来自 DESKTOP_REPORT_PID */
  pid: string;
  /** 事件时间戳(epoch ms) */
  ts: number;
  /** 渲染层/主进程透传的事件负载 */
  payload: unknown;
}

const FLUSH_BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5000;
const OVERFLOW_FILE = "report-queue.jsonl";

interface TransportState {
  endpoint: string;
  pid: string;
  sampleRate: number;
  queue: ReportEntry[];
  timer: NodeJS.Timeout | null;
  flushing: boolean;
}

let state: TransportState | null = null;

function overflowPath(): string {
  return join(app.getPath("userData"), OVERFLOW_FILE);
}

/** 溢出落盘:jsonl 逐行一条,读取侧容忍单行损坏只丢该行。 */
function persistOverflow(entries: ReportEntry[]): void {
  if (entries.length === 0) return;
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    const lines = entries.map((entry) => JSON.stringify(entry)).join("\n");
    appendFileSync(overflowPath(), `${lines}\n`, "utf8");
  } catch (error) {
    logger.error("transport 溢出落盘失败,事件丢弃", error);
  }
}

/** 启动重发:读回上次溢出落盘的事件并入队,flush 由 index.ts 在 app ready 后触发(net.fetch 需 ready)。 */
function resendOverflow(): void {
  if (state == null) return;
  const file = overflowPath();
  if (!existsSync(file)) return;
  try {
    const lines = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    let restored = 0;
    for (const line of lines) {
      try {
        state.queue.push(JSON.parse(line) as ReportEntry);
        restored += 1;
      } catch {
        logger.warn("transport 跳过损坏的落盘行");
      }
    }
    rmSync(file, { force: true });
    if (restored > 0) {
      logger.info(`transport 已从落盘队列恢复 ${restored} 条待重发事件`);
    }
  } catch (error) {
    logger.error("transport 恢复落盘队列失败", error);
  }
}

/** 返回是否初始化成功(false = endpoint/pid 缺失,管道未启用)。 */
export function initTransport(config: DesktopConfig): boolean {
  if (config.reportEndpoint == null || config.reportPid == null) {
    logger.info(
      "transport 未初始化:DESKTOP_REPORT_ENDPOINT/DESKTOP_REPORT_PID 缺任一即整条管道关闭"
    );
    return false;
  }
  state = {
    endpoint: config.reportEndpoint,
    pid: config.reportPid,
    sampleRate: config.reportSampleRate,
    queue: [],
    timer: null,
    flushing: false
  };
  resendOverflow();
  return true;
}

/** 入队一条事件;管道未初始化或未命中采样返回 false(静默丢弃,不抛错)。 */
export function enqueueReport(kind: ReportKind, payload: unknown): boolean {
  if (state == null) {
    logger.debug(`transport 未初始化,丢弃上报事件:${kind}`);
    return false;
  }
  if (Math.random() >= state.sampleRate) {
    return false;
  }
  state.queue.push({ kind, pid: state.pid, ts: Date.now(), payload });
  if (state.queue.length >= FLUSH_BATCH_SIZE) {
    void flushReports();
    return true;
  }
  if (state.timer == null) {
    state.timer = setTimeout(() => {
      if (state != null) state.timer = null;
      void flushReports();
    }, FLUSH_INTERVAL_MS);
  }
  return true;
}

/** 批量上报当前队列;失败整批落盘等待启动重发。并发由 flushing 标志串行化。 */
export async function flushReports(): Promise<void> {
  if (state == null || state.flushing || state.queue.length === 0) return;
  state.flushing = true;
  const batch = state.queue.splice(0, state.queue.length);
  try {
    const response = await net.fetch(state.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pid: state.pid, events: batch })
    });
    if (!response.ok) {
      throw new Error(`endpoint 返回 ${response.status}`);
    }
  } catch (error) {
    persistOverflow(batch);
    logger.error("transport 上报失败,已落盘等待启动重发", error);
  } finally {
    if (state != null) state.flushing = false;
  }
}

/** 退出前调用:停掉定时器并把未发送事件落盘,下次启动重发。 */
export function disposeTransport(): void {
  if (state == null) return;
  if (state.timer != null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  persistOverflow(state.queue.splice(0, state.queue.length));
  state = null;
}
