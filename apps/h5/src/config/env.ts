// h5 环境配置单点读取口(方案见 docs/h5-shell-plan.md §3 config 分区)。
//
// 双端读取规则(照抄 site 既有模式,见 apps/site/src/config/rum.ts + apps/site/modern.config.ts):
// - 浏览器端 bundle 不存在 Node 的 process,裸 process.env 引用会 ReferenceError(实测踩过),
//   因此所有 env 按"成员访问 process.env.XXX"书写,由 modern.config.ts 的 source.define
//   构建期内联为字面量(未配置内联为空串);
// - SSR 服务端/单测读真实 process.env(vi.stubEnv 可覆盖);
// - H5_API_BASE 只在 SSR 端有意义(浏览器端恒走同源相对路径),不做内联。
export interface H5Env {
  /** SSR 服务端请求 Go server 的绝对地址;浏览器端为空串(同源相对路径)。 */
  apiBase: string;
  /** 阿里云 ARMS RUM 上报端点;空串 = 未配置,监控不启用(见 config/feature.ts)。 */
  rumEndpoint: string;
  /** ARMS RUM 应用 pid;与 rumEndpoint 任一缺失即不启用。 */
  rumPid: string;
  /** 自有埋点上报端点;空串 = 未配置,埋点不启用(core/track 未启用走 no-op)。 */
  trackEndpoint: string;
  /** 监控采样率 [0,1],1 = 全采;越界截断,非法/缺省回退 1。 */
  monitorSampleRate: number;
  /** 埋点采样率 [0,1],语义同上。 */
  trackSampleRate: number;
}

// SSR 端 API 默认地址:与 src/api/client.ts 口径一致(Go server h5 受众链 18085)。
const DEFAULT_API_BASE = "http://127.0.0.1:18085";
// 采样率默认值:全采(真实采样在阶段 2 接线,配置槽位先钉住)。
const DEFAULT_SAMPLE_RATE = 1;

function isServer(): boolean {
  return typeof window === "undefined";
}

// 字符串读取:undefined/空串/纯空白统一视为未配置,回退默认值(空值边界单点处理)。
function readString(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? fallback : trimmed;
}

// 采样率读取:空值/非数字回退默认;[0,1] 之外越界截断(NaN 先判,Infinity 走截断)。
function readSampleRate(value: string | undefined): number {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    return DEFAULT_SAMPLE_RATE;
  }
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    return DEFAULT_SAMPLE_RATE;
  }
  return Math.min(1, Math.max(0, parsed));
}

// 单点读取口:整个应用只允许本函数出现 process.env 成员访问。
function readEnv(): H5Env {
  if (isServer()) {
    return {
      apiBase: readString(process.env.H5_API_BASE, DEFAULT_API_BASE),
      rumEndpoint: readString(process.env.RUM_ENDPOINT, ""),
      rumPid: readString(process.env.RUM_PID, ""),
      trackEndpoint: readString(process.env.TRACK_ENDPOINT, ""),
      monitorSampleRate: readSampleRate(process.env.H5_MONITOR_SAMPLE_RATE),
      trackSampleRate: readSampleRate(process.env.H5_TRACK_SAMPLE_RATE)
    };
  }
  // 浏览器端:API 走同源相对路径;上报地址与采样率由构建期内联(source.define),
  // 未配置读到空串 → 特性不启用/采样率回默认。
  return {
    apiBase: "",
    rumEndpoint: readString(process.env.RUM_ENDPOINT, ""),
    rumPid: readString(process.env.RUM_PID, ""),
    trackEndpoint: readString(process.env.TRACK_ENDPOINT, ""),
    monitorSampleRate: readSampleRate(process.env.H5_MONITOR_SAMPLE_RATE),
    trackSampleRate: readSampleRate(process.env.H5_TRACK_SAMPLE_RATE)
  };
}

// 只读常量:模块加载时读取一次,运行期不变(配置属于构建/启动期注入)。
export const env: Readonly<H5Env> = readEnv();
