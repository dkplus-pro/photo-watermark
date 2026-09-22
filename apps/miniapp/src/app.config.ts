// lazyCodeLoading:仅注入被使用到的自定义组件代码(微信基础库 >= 2.11.1),
// 缩减主包注入体积;新增组件无需在此登记。subpackages 为分包骨架坑:业务页面
// 默认进分包(见 apps/miniapp/AGENTS.md §2-6),占坑期主包只保留 index。
export default defineAppConfig({
  pages: ["pages/index/index"],
  lazyCodeLoading: "requiredComponents",
  subpackages: [
    // 业务分包坑:首批业务落地时填入(roots + pages),主包只保留首屏与壳
  ],
  window: {
    backgroundTextStyle: "light",
    navigationBarBackgroundColor: "#fff",
    navigationBarTitleText: "WeChat",
    navigationBarTextStyle: "black"
  }
});
