// 站点主题 token 配置坑(阶段 2,docs/site-shell-plan.md §4 阶段 2.1):
// 全站改色/改字体等主题调整只在本文件进行,经 ConfigProvider theme 传入 Arco;
// 默认空 = 沿用 Arco 默认 token(公开站无品牌定制)。新增 token 见
// @arco-design/web-react 的 TokenType(Design Lab 导出可直接粘贴)。
import type { ThemeConfig } from "@arco-design/web-react/es/ConfigProvider/interface";

export const siteTheme: ThemeConfig = {
  // 示例(默认 Arco 蓝绿,公开站保持默认):
  // "primary-6": "#00B42A",
};
