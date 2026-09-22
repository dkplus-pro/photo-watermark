import { Breadcrumb } from "@arco-design/web-react";
import { Link, useLocation } from "@modern-js/runtime/router";
import type { ReactNode } from "react";

import { matchMenuTrail, type MenuConfig } from "../config/menu";
import { APP_BASENAME } from "../constants";

interface PageContainerProps {
  /** 页头右侧操作区插槽(如"新建"按钮)。 */
  extra?: ReactNode;
  children: ReactNode;
}

// 页面骨架(UI 规范见 docs/admin.md):面包屑 + 操作区放内容区顶部,不再渲染页内标题
// (标题与面包屑叶子重复,已移除);顶栏只保留用户区。
// 面包屑自动取 config/menu.tsx 的标题链(首页 / 系统管理 / 用户管理),页面不手写。
export default function PageContainer({ extra, children }: PageContainerProps) {
  const { pathname } = useLocation();
  // 应用内路径 = 剥离 basename 后的剩余段(与 layout 的口径一致)。
  const appPathname = pathname.startsWith(APP_BASENAME)
    ? pathname.slice(APP_BASENAME.length) || "/"
    : pathname;
  const trail: MenuConfig[] = matchMenuTrail(appPathname);

  return (
    <div className="page-container">
      <Breadcrumb className="page-breadcrumb">
        <Breadcrumb.Item>
          <Link to="/">首页</Link>
        </Breadcrumb.Item>
        {trail.map((node) => (
          <Breadcrumb.Item key={node.path}>{node.title}</Breadcrumb.Item>
        ))}
      </Breadcrumb>
      {extra ? <div className="page-extra">{extra}</div> : null}
      {children}
    </div>
  );
}
