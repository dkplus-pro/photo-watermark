import { useLoaderData } from "@modern-js/runtime/router";

import ErrorView from "../component/error-view";
import PageShell from "../component/page-shell";
import ShareHeader from "../component/share-header";

import type { HomePageData } from "./page.data";

import "./page.css";

// ping 加载失败时的降级文案(loader 已把请求失败降级为 null,这里只兜渲染不空)。
const FALLBACK_PING_MESSAGE = "服务暂不可用,请稍后重试";

// 首页:服务端 loader 调 /api/h5/ping,渲染 ping 返回的 message(SSR 数据链路硬证据,
// 见 docs/monorepo-expansion-plan.md 阶段 3;数据流照抄 site 首页 useLoaderData 范式)。
// 布局走壳组件(docs/h5-shell-plan.md §3):成功 = PageShell + ShareHeader 页头,
// 失败 = PageShell + ErrorView 降级视图;loader 数据流与降级文案均不变。
export default function HomePage() {
  const ping = useLoaderData() as HomePageData;
  const message = ping?.message || FALLBACK_PING_MESSAGE;

  if (!ping) {
    return (
      <PageShell>
        <ErrorView message={message} description="首页数据(/api/h5/ping)加载失败,请稍后重试。" />
      </PageShell>
    );
  }

  return (
    <PageShell header={<ShareHeader title={message} />}>
      <p className="h5-home-subtitle">活动 H5 占坑页:数据来自 /api/h5/ping(SSR loader)。</p>
    </PageShell>
  );
}
