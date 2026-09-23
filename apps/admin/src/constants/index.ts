// 全局常量(目录分区约定见 apps/admin/AGENTS.md)。

export const SYSTEM_NAME = "水印相框";

// 路由 basename 与资源前缀同源(D11),值在构建期由 source.define 内联。
// Pages 子路径部署下为 `/photo-watermark`,本地/根路径部署下为 "/"。
export const APP_BASENAME = __APP_BASE_PATH__;

// 公共页脚版权文案,年份写死而非运行时取值,保证渲染结果可测。
export const COPYRIGHT_TEXT = "© 2026 dkplus 水印相框";

// 静态资源清单(阶段 6)与主题字体(阶段 9)共用的资源路径事实源。
export const FRAMES_CATALOG_PATH = "frames.json";
export const LOGOS_CATALOG_PATH = "logos.json";

// 断点:与 arco Grid 的 xs/sm 分界一致,<768 视为移动端(整壳 Sider→Drawer);
// >=1024 视为桌面(相框列表一行 4 列),两者之间为平板(一行 3 列)。
export const MOBILE_BREAKPOINT = 768;
export const DESKTOP_BREAKPOINT = 1024;
