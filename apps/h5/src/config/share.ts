// 分享/SEO 配置坑(方案 §3「分享/SEO 坑」):活动页 title/description/og:image 集中处,
// 后续由根布局 meta/OG 槽位与各活动路由覆写消费(消费接线归阶段 2.C/3,本卡只落配置位)。
export interface ShareConfig {
  /** 分享标题;不配置时 Modern.js 回退 modern.config.ts 的 html.title。 */
  title: string;
  /** 分享描述。 */
  description: string;
  /** OG 分享图(CDN 绝对地址);空串 = 未配置。 */
  ogImage: string;
}

// TODO(阶段 2.C,微信 JSSDK 占位):只留配置位不实现 —— JSSDK 需要服务端签名接口支持,
// 接入时在根布局 client-only 动态加载,appId/jsApiList 等配置在此扩展,禁止提前引入 SDK。
export interface WechatShareSlot {
  /** 公众号 appId(JSSDK 接入后使用);空串 = 未接入。 */
  appId: string;
}

// 默认分享配置:活动页可在路由层覆写字段,但字段形状以 ShareConfig 为准。
export const shareConfig: Readonly<ShareConfig> = {
  title: "CMS Template H5",
  description: "CMS Template 活动 H5",
  ogImage: ""
};

export const wechatShareSlot: Readonly<WechatShareSlot> = { appId: "" };
