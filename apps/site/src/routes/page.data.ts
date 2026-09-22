import { SiteController } from "../api/controllers.gen";
import type { SiteInfo } from "../api/generated/cMSSiteAPI.schemas";

// 首页数据加载:服务端拉站点公开信息渲染站名/Logo,是 SSR 数据链路的硬证据
// (curl 首页 HTML 直接含站名,见 docs/quality-and-site-plan.md 阶段 17)。
// 与 layout.data 一样失败降级为 null,不阻断渲染;请求失败只影响主视觉文案。
export type SiteHomeData = SiteInfo | null;

export async function loader(): Promise<SiteHomeData> {
  try {
    return await SiteController.getSiteInfo();
  } catch (error) {
    console.error("首页 site-info 加载失败", error);
    return null;
  }
}
