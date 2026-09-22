/**
 * 自动更新坑:仅定义接口与空实现,不接 electron-updater(仓库暂无更新服务端)。
 * DESKTOP_UPDATE_URL 配置后只打印提示不消费;后续接入真实更新服务时在此实现 IUpdater
 * 并替换 createUpdater 的返回,壳内其他模块禁止自行检查更新。
 * 装配约束:index.ts 装配顺序最后一步调用 createUpdater。
 */
import type { DesktopConfig } from "./config";
import { logger } from "./logger";

export interface IUpdater {
  /** 检查并安装更新;无更新服务时为空操作。 */
  checkForUpdates(): Promise<void>;
}

export const nullUpdater: IUpdater = {
  // NullUpdater:恒为空操作,不发起任何网络请求。
  checkForUpdates: () => Promise.resolve()
};

export function createUpdater(config: DesktopConfig): IUpdater {
  if (config.updateUrl != null) {
    logger.info(`updater 坑:DESKTOP_UPDATE_URL=${config.updateUrl} 已配置,自动更新未实现,当前忽略`);
  }
  return nullUpdater;
}
