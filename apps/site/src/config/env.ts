// site 环境变量配置坑:zod 校验 + 类型化导出(方案见 docs/site-shell-plan.md 阶段 3.1)。
//
// 设计约束:
// - 全量槽位可选:未配置走默认值;配置了但非法(如非 URL)在启动时抛出带字段名的错误,
//   让配置错误在 SSR 启动阶段即暴露,而不是运行时静默失效;
// - 双端读取规则与 src/api/client.ts 一致(docs/site.md「SSR 注意事项」):浏览器分支禁止
//   裸读 process.env(客户端 bundle 无 Node process)。RUM_* 是客户端可见变量,由
//   modern.config.ts 的 source.define 对按成员访问的 process.env.RUM_* 构建期内联为
//   字面量(未配置内联为空串),因此读取必须保持同样的按成员访问写法;
//   SITE_API_BASE/TRACK_ENDPOINT 仅在 typeof window === "undefined" 分支读取;
// - 消费方一律使用 siteEnv 单例(或注入 env 源调用 loadSiteEnv,便于测试),
//   禁止在业务代码散读 process.env。
import { z } from "zod";

// 各槽位默认值:RUM/TRACK 空串 = 未配置(对应能力关闭);SITE_API_BASE 默认指向本机 Go server。
const ENV_DEFAULTS = {
  SITE_API_BASE: "http://127.0.0.1:8080",
  RUM_ENDPOINT: "",
  RUM_PID: "",
  TRACK_ENDPOINT: ""
} as const;

// URL 型槽位:未配置(缺省或空串)合法;一旦配置必须是可发起请求的绝对 URL。
const optionalUrl = z.union([z.literal(""), z.url({ message: "必须是合法的绝对 URL" })]);

const envSchema = z.object({
  /** SSR 服务端请求 Go server 的绝对地址;浏览器端走同源相对路径,不消费此值。 */
  SITE_API_BASE: optionalUrl.default(ENV_DEFAULTS.SITE_API_BASE),
  /** 阿里云 ARMS RUM 上报地址;与 RUM_PID 任一缺失即关闭 RUM(见 features.ts)。 */
  RUM_ENDPOINT: optionalUrl.default(ENV_DEFAULTS.RUM_ENDPOINT),
  /** ARMS RUM 应用 pid(非 URL 槽位);与 RUM_ENDPOINT 配对使用。 */
  RUM_PID: z.string().default(ENV_DEFAULTS.RUM_PID),
  /** 自定义埋点 HTTP 上报端点(sendBeacon);未配置时埋点 no-op。 */
  TRACK_ENDPOINT: optionalUrl.default(ENV_DEFAULTS.TRACK_ENDPOINT)
});

// 类型化 env(camelCase 语义名,值为已应用默认值的 string;空串表示未配置)。
export interface SiteEnv {
  /** SSR 服务端 API 绝对地址。 */
  siteApiBase: string;
  /** RUM 上报地址;空串表示未配置。 */
  rumEndpoint: string;
  /** RUM 应用 pid;空串表示未配置。 */
  rumPid: string;
  /** 埋点上报端点;空串表示未配置。 */
  trackEndpoint: string;
}

// 默认 env 源:RUM_* 按成员访问(source.define 构建期内联,禁止裸 process.env 引用);
// 服务端专属变量只在 typeof window === "undefined" 分支读取(与 client.ts 双端 baseURL
// 规则同源;浏览器 bundle 无 Node process)。
export function defaultEnv(): Record<string, string | undefined> {
  // 客户端可见变量:双端都读(浏览器端为构建期内联字面量,SSR/测试读真实 process.env)。
  const shared = {
    RUM_PID: process.env.RUM_PID,
    RUM_ENDPOINT: process.env.RUM_ENDPOINT
  };
  if (typeof window !== "undefined") {
    return shared;
  }
  return {
    ...shared,
    SITE_API_BASE: process.env.SITE_API_BASE,
    TRACK_ENDPOINT: process.env.TRACK_ENDPOINT
  };
}

// 解析并校验 env;非法值抛出带明确字段名的错误(SSR 启动即失败,快速暴露配置错误)。
export function loadSiteEnv(source: Record<string, string | undefined> = defaultEnv()): SiteEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`site 环境变量校验失败(${detail});请对照 apps/site/.env.example 修正`);
  }
  const env = parsed.data;
  return {
    siteApiBase: env.SITE_API_BASE,
    rumEndpoint: env.RUM_ENDPOINT,
    rumPid: env.RUM_PID,
    trackEndpoint: env.TRACK_ENDPOINT
  };
}

// 启动即校验的单例:本模块首次被 import(SSR 启动/客户端首屏加载)时完成校验。
export const siteEnv: SiteEnv = loadSiteEnv();
