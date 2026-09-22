// core/track 公共参数组装:每次埋点附带的设备/系统/网络/版本字段。
// 一切 wx.* 访问经注入的宿主对象 + canIUse 判空降级,缺失字段回退 "unknown",
// 保证参数组装永不抛错、永不阻塞埋点主链路(见 docs/miniapp-shell-plan.md §5 阶段 2.2)。

/** 公共参数:所有埋点事件都会携带 */
export interface CommonParams {
  /** 应用版本号(defineConstants 注入,单测兜底 "0.0.0") */
  version: string;
  /** 构建时刻,单测兜底空串 */
  buildTime: string;
  /** 用户标识:C 端用户体系落地前恒为 null(配置坑) */
  uid: string | null;
  /** 设备型号,取不到为 "unknown" */
  device: string;
  /** 系统与版本,取不到为 "unknown" */
  system: string;
  /** 网络类型(wifi/4g/...),取不到为 "unknown" */
  network: string;
}

/** 全局 wx 对象子集(仅公共参数收集用到的方法)。 */
export interface WxLike {
  getSystemInfoSync?: () => {
    model?: string;
    system?: string;
    SDKVersion?: string;
  };
  getNetworkType?: (options: { success: (result: { networkType?: string }) => void }) => void;
  canIUse?: (schema: string) => boolean;
}

/** 缺省宿主:小程序运行时的全局 wx(单测注入 fake)。 */
function defaultWx(): WxLike | undefined {
  return (globalThis as { wx?: WxLike }).wx;
}

const UNKNOWN = "unknown";

export interface CollectCommonParamsOptions {
  /** 注入宿主(单测);缺省读全局 wx */
  wx?: WxLike;
  version?: string;
  buildTime?: string;
}

/**
 * 同步收集公共参数:系统信息走 getSystemInfoSync;网络类型异步接口在初始化时
 * 已由 track 模块缓存最新值(见 paramsCache),此处只读缓存,不发起异步调用。
 */
export function collectCommonParams(options: CollectCommonParamsOptions = {}): CommonParams {
  const wx = options.wx ?? defaultWx();
  let device = UNKNOWN;
  let system = UNKNOWN;
  if (wx?.getSystemInfoSync && typeof wx.getSystemInfoSync === "function") {
    try {
      const info = wx.getSystemInfoSync();
      device = typeof info?.model === "string" && info.model !== "" ? info.model : UNKNOWN;
      system = typeof info?.system === "string" && info.system !== "" ? info.system : UNKNOWN;
    } catch {
      // 取系统信息失败不影响埋点
    }
  }
  return {
    version: options.version ?? "",
    buildTime: options.buildTime ?? "",
    uid: null, // uid 坑:C 端用户体系落地后接入(见 docs/miniapp-shell-plan.md §4)
    device,
    system,
    network: cachedNetworkType()
  };
}

// 网络类型缓存:wx.getNetworkType 是异步接口,埋点路径只读缓存;
// 模块初始化与网络变化时刷新,取不到保持 "unknown"。
let networkCache = UNKNOWN;

/** 刷新网络类型缓存(app 启动与 wx.onNetworkStatusChange 时调用;单测可直接注入)。 */
export function refreshNetworkType(wx?: WxLike, network?: string): void {
  const host = wx ?? defaultWx();
  if (network !== undefined) {
    networkCache = network;
    return;
  }
  if (host?.getNetworkType && typeof host.getNetworkType === "function") {
    try {
      host.getNetworkType({
        success: result => {
          if (typeof result?.networkType === "string" && result.networkType !== "") {
            networkCache = result.networkType;
          }
        }
      });
      return;
    } catch {
      // 异步刷新失败保持旧缓存
    }
  }
  // 宿主无 getNetworkType 能力:显式降级,避免残留其他宿主的旧值
  networkCache = UNKNOWN;
}

function cachedNetworkType(): string {
  return networkCache;
}

// 模块加载即尝试刷新一次(prod 真机上有值,单测环境静默 no-op)。
refreshNetworkType();
