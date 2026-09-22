// core/perf:性能采集(方案 docs/miniapp-shell-plan.md §5 阶段 2.3)。
// - 启动耗时:App onLaunch 到首页首帧由 app.tsx 侧调用 mark/measure 标记(接线在 N3);
// - wx.getPerformance 能力检测 + 关键指标读取,canIUse 判空降级;
// - mark(name)/measure(name, value?) 自定义指标透传 transport 队列(sink 组合同 track)。
// 依赖方向硬规则见 apps/miniapp/AGENTS.md §1;模块独立,不 import track/monitor。
import { getAppVersion, getBuildTime } from "../../config";
import { createReportQueue, type ReportQueue } from "../transport/queue";
import { createTransportSinks } from "../transport/sink";

/** 全局 wx 对象子集(perf 只用到的方法)。 */
export interface WxPerfLike {
  getPerformance?: () => {
    createObserver?: (callback: (entry: { name?: string; path?: string; duration?: number }) => void) => {
      observe: (types: { entryTypes: string[] }) => void;
      disconnect: () => void;
    };
  };
  canIUse?: (schema: string) => boolean;
}

function defaultWx(): WxPerfLike | undefined {
  return (globalThis as { wx?: WxPerfLike }).wx;
}

/** 性能指标记录(进 transport 队列,level=info)。 */
export interface PerfRecord {
  event: string;
  timestamp: number;
  level: "info";
  props: Record<string, unknown>;
}

export interface CreatePerfOptions {
  queue?: ReportQueue;
  /** 注入宿主(单测);缺省全局 wx */
  wx?: WxPerfLike;
  now?: () => number;
  version?: string;
  buildTime?: string;
}

export interface Perf {
  /** 是否具备 wx.getPerformance 能力(诊断用) */
  supportsPerformance(): boolean;
  /** 自定义打点:name 蛇形命名(如 app.launch / page.first_render) */
  mark(name: string, value?: number): void;
  /** 读基础库性能条目(render/firstRender 等),canIUse 不支持时返回空数组 */
  readEntries(): Array<{ name: string; path: string; duration: number }>;
}

export function createPerf(options: CreatePerfOptions = {}): Perf {
  const queue =
    options.queue ??
    createReportQueue({
      sinks: createTransportSinks({ dev: false, httpEndpoint: "" })
    });
  const wx = options.wx ?? defaultWx();
  const now = options.now ?? (() => Date.now());
  const version = options.version ?? getAppVersion();
  const buildTime = options.buildTime ?? getBuildTime();
  // 已收集条目:null = 观察器尚未创建(含不可用场景)
  let entries: Array<{ name: string; path: string; duration: number }> | null = null;

  function enqueue(name: string, props: Record<string, unknown>): void {
    const record: PerfRecord = {
      event: `perf.${name}`,
      timestamp: now(),
      level: "info",
      props: { version, buildTime, ...props }
    };
    queue.enqueue(record);
  }

  return {
    supportsPerformance() {
      const perf = wx?.getPerformance?.();
      return Boolean(perf?.createObserver);
    },
    mark(name, value) {
      enqueue(name, value === undefined ? {} : { duration: value });
    },
    readEntries() {
      // 观察器惰性创建且只建一次:wx 语义是回调持续推送,这里累积后返回快照
      if (entries === null) {
        const perf = wx?.getPerformance?.();
        const observer = perf?.createObserver;
        if (!observer) {
          return [];
        }
        // 局部 const 数组承接回调推送(闭包内保持非空语义),再挂到模块缓存
        const collected: Array<{ name: string; path: string; duration: number }> = [];
        try {
          observer(entry => {
            if (
              typeof entry?.name === "string" &&
              typeof entry?.duration === "number" &&
              Number.isFinite(entry.duration)
            ) {
              collected.push({
                name: entry.name,
                path: typeof entry.path === "string" ? entry.path : "",
                duration: entry.duration
              });
            }
          }).observe({ entryTypes: ["render", "script"] });
          entries = collected;
        } catch {
          // 观察器创建失败:能力声明与运行时不一致,按不支持处理
          entries = null;
          return [];
        }
      }
      return [...entries];
    }
  };
}

/** 业务侧单例。 */
export const perf = createPerf();

/** 业务入口:自定义打点。 */
export function mark(name: string, value?: number): void {
  perf.mark(name, value);
}
