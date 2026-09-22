import { Layout } from "@arco-design/web-react";

import { COPYRIGHT_TEXT } from "../constants";

// 公共页脚(UI 规范见 docs/admin.md):版权标识,居中、次要文字色;
// 登录页不渲染(由 layout 的路由守卫分支天然保证)。
export default function AppFooter() {
  return <Layout.Footer className="app-footer">{COPYRIGHT_TEXT}</Layout.Footer>;
}
