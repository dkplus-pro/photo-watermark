// 全局常量(见 docs/admin.md 的目录分区约定)。
export const SYSTEM_NAME = "CMS 管理后台";

export const TOKEN_STORAGE_KEY = "cms.admin.token";

// 后台网页挂在网关的 /admin 子路径下(见 docs/mvp-plan.md 阶段 8):
// 同时是路由 basename(runtime.config.ts)与 layout 剥离前缀的同一事实源。
export const APP_BASENAME = "/admin";

// 公共页脚版权文案(占位;TODO:上线时替换为真实部署主体)。
// 年份固定写入文案而非运行时取当前时间,保证渲染结果可测试。
export const COPYRIGHT_TEXT = "© 2026 CMS Template";
