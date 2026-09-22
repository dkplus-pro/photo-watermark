import { Layout } from "@arco-design/web-react";

import { COPYRIGHT_TEXT } from "../constants";

// 公共页脚(全局 layout 内唯一渲染点):版权标识,居中、次要文字色。
export default function AppFooter() {
  return <Layout.Footer className="app-footer">{COPYRIGHT_TEXT}</Layout.Footer>;
}
