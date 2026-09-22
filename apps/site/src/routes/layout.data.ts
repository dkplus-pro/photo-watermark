import { SiteController } from "../api/controllers.gen";
import type { SiteInfo } from "../api/generated/cMSSiteAPI.schemas";

// 布局级数据加载(站名/Logo,供页头渲染)。App Router 约定:layout.data.ts 具名导出
// 的 loader 在 SSR 下于服务端执行,数据随 HTML 下发(见 docs/site.md「SSR 注意事项」)。
// loader 内不得引用任何客户端状态;服务端请求失败时降级返回 null(默认站名兜底),
// 不阻断整页 SSR 渲染(测试用例固化该语义)。
export type SiteLayoutData = SiteInfo | null;

export async function loader(): Promise<SiteLayoutData> {
  try {
    return await SiteController.getSiteInfo();
  } catch (error) {
    console.error("site-info 加载失败,降级为默认站名", error);
    return null;
  }
}
