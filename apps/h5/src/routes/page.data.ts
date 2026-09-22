import { H5Controller } from "../api/controllers.gen";
import type { Ping200 } from "../api/generated/cmsH5Api.schemas";

// 首页数据加载:服务端调 /api/h5/ping 渲染联通性结果,是 SSR 数据链路的硬证据
// (数据流照抄 site 首页 page.data 范式)。loader 内不引用任何客户端状态;
// 请求失败自捕获降级为 null,不阻断 SSR 渲染,页面端显示降级文案。
export type HomePageData = Ping200 | null;

export async function loader(): Promise<HomePageData> {
  try {
    return await H5Controller.ping();
  } catch (error) {
    console.error("ping 加载失败,降级为占位文案", error);
    return null;
  }
}
