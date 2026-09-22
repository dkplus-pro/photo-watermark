import { defineRuntimeConfig } from "@modern-js/runtime";

import { APP_BASENAME } from "./constants";

// 路由 basename:后台网页整体挂在 /admin 下(见 docs/mvp-plan.md 阶段 8)。
// 与 constants.APP_BASENAME 同源,layout 用同一常量剥离前缀做匹配。
export default defineRuntimeConfig({
  router: {
    basename: APP_BASENAME
  }
});
