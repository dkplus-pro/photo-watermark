// React 19 下 Semi 的命令式 API(Toast 等)与弹出层组件依赖官方 react19-adapter,
// 必须先于任何 Semi 组件导入,否则动态挂载走已移除的 ReactDOM.render 报错(见 react19 官方文档)。
import "@douyinfe/semi-ui/react19-adapter";
import { IconIndentLeft, IconIndentRight } from "@douyinfe/semi-icons";
import { Layout as SemiLayout, Nav, SideSheet } from "@douyinfe/semi-ui";
import { Outlet, useLocation, useNavigate } from "@modern-js/runtime/router";
import { useMemo, useState } from "react";

import AppFooter from "../components/app-footer";
import AuthorQrcodeFloat from "../components/author-qrcode-float";
import ErrorBoundary from "../components/error-boundary";
import { sidebarMenus } from "../config/menu";
import { useRum } from "../config/rum";
import { APP_BASENAME, SYSTEM_NAME } from "../constants";
import { useIsMobile } from "../hooks/use-responsive";
import { useUiStore } from "../store/ui";
import { assetUrl } from "../utils/asset-url";

// Semi 默认主题样式随组件按需自动引入,这里只挂壳层自定义样式(默认主题不引入额外 css)。
import "./index.css";

const { Header, Content } = SemiLayout;

// 目录项(有 children 的节点)不是路由:Semi Nav 的目录点击也会回调 onClick,
// 用这个集合过滤掉,只让叶子项触发跳转。
const DIRECTORY_KEYS = new Set(
  sidebarMenus.filter((node) => node.children?.length).map((node) => node.path)
);

// 全局根布局:本站无鉴权、无服务端状态,壳层只做导航骨架与响应式切换。
// 根级 ErrorBoundary 兜住壳层渲染错误,页面级 ErrorBoundary 兜住 Outlet 内错误(见阶段 9B)。
export default function Layout() {
  // PV/UV 埋点在壳层一次性装配(仅生产环境初始化,dev/单测不上报),随路由切换自动补报。
  useRum();
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}

interface SideMenuProps {
  appPathname: string;
  openKeys: string[];
  collapse?: boolean;
  onOpenKeysChange: (openKeys: string[]) => void;
  onNavigate: (key: string) => void;
}

// 菜单渲染只此一份实现:桌面侧栏与移动 SideSheet 复用同一组件,
// 选中态与展开态由壳层持有,避免两处 Nav 的状态各自分裂。
// 折叠态的悬浮提示由 Semi Nav 自带(悬停显示条目文本),无需手动配置。
function SideMenu({
  appPathname,
  openKeys,
  collapse,
  onOpenKeysChange,
  onNavigate
}: SideMenuProps) {
  // 菜单声明是静态数据,一次性映射成 Semi Nav 的 items 结构:
  // 带 children 的目录生成嵌套 items,叶子直接平移(itemKey 即应用内路径)。
  const navItems = useMemo(
    () =>
      sidebarMenus.map((node) =>
        node.children?.length
          ? {
              itemKey: node.path,
              text: node.title,
              icon: node.icon,
              items: node.children.map((child) => ({
                itemKey: child.path,
                text: child.title,
                icon: child.icon
              }))
            }
          : { itemKey: node.path, text: node.title, icon: node.icon }
      ),
    []
  );

  return (
    <Nav
      className="app-nav"
      items={navItems}
      selectedKeys={[appPathname]}
      openKeys={openKeys}
      isCollapsed={collapse}
      // 受控展开:回调携带最新 openKeys,壳层据此同步受控状态。
      onOpenChange={(data) => onOpenKeysChange([...((data.openKeys ?? []) as string[])])}
      // 目录点击只负责展开/收起(onOpenChange 已处理),过滤掉目录 key 防止跳到非路由。
      onClick={(data) => {
        if (typeof data.itemKey === "string" && !DIRECTORY_KEYS.has(data.itemKey)) {
          onNavigate(data.itemKey);
        }
      }}
      style={{ width: "100%" }}
    />
  );
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const siderCollapsed = useUiStore((state) => state.siderCollapsed);
  const toggleSider = useUiStore((state) => state.toggleSider);
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);

  // 应用内路径 = 剥离 basename 后的剩余段(URL {basename}/{页面} 对应路由 {页面})。
  // 路由匹配(navigate / menu key / 面包屑)全程用应用内路径,basename 由 router 统一叠加。
  const appPathname =
    APP_BASENAME !== "/" && location.pathname.startsWith(APP_BASENAME)
      ? location.pathname.slice(APP_BASENAME.length) || "/"
      : location.pathname;

  // 受控展开:菜单是静态声明,挂载时即把含 children 的目录全量展开,之后完全交给用户点击。
  const [openKeys, setOpenKeys] = useState<string[]>(() =>
    sidebarMenus.filter((node) => node.children?.length).map((node) => node.path)
  );

  // 抽屉里点菜单项后自动收起;桌面端点击时这是同值写入,不产生多余渲染(见 src/store/ui.ts)。
  const handleMenuNavigate = (key: string) => {
    setMobileNavOpen(false);
    navigate(key);
  };

  const menuProps = {
    appPathname,
    openKeys,
    onOpenKeysChange: setOpenKeys,
    onNavigate: handleMenuNavigate
  };

  return (
    <>
      {/* Semi 的 Layout.Sider 只支持断点响应式,不支持受控折叠,
          侧栏折叠(220 ↔ 60)由 zustand 状态 + 本组件类名驱动。 */}
      <SemiLayout className="app-shell has-sider">
        {!isMobile ? (
          <aside className={`app-sider${siderCollapsed ? " app-sider-collapsed" : ""}`}>
            <div className="app-logo">
              {/* logo 图恒显示:收起后顶部是独立 logo,而不是应用名首字。
                  public 资源必须经 assetUrl 拼 basePath,裸 `/assets/...` 在子路径部署下 404。 */}
              <img className="app-logo-img" src={assetUrl("assets/brand/logo.png")} alt="" />
              {!siderCollapsed ? SYSTEM_NAME : null}
            </div>
            <div
              className="app-sider-trigger"
              role="button"
              aria-label={siderCollapsed ? "展开侧边栏" : "收起侧边栏"}
              onClick={toggleSider}
            >
              {siderCollapsed ? <IconIndentRight /> : <IconIndentLeft />}
            </div>
            <SideMenu {...menuProps} collapse={siderCollapsed} />
          </aside>
        ) : null}
        <SemiLayout className="app-main">
          {/* 顶栏:移动端左侧汉堡按钮开抽屉,右侧只放应用名(无用户区,本站无登录)。 */}
          <Header className="app-header">
            {isMobile ? (
              <span
                className="app-nav-trigger"
                role="button"
                aria-label={mobileNavOpen ? "关闭导航" : "打开导航"}
                onClick={() => setMobileNavOpen(!mobileNavOpen)}
              >
                {mobileNavOpen ? <IconIndentRight /> : <IconIndentLeft />}
              </span>
            ) : null}
          </Header>
          <Content className="app-content">
            {/* 页面级 ErrorBoundary:页面崩溃时侧边栏/顶栏仍可用。 */}
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </Content>
          <AppFooter />
        </SemiLayout>
      </SemiLayout>
      <AuthorQrcodeFloat />
      {isMobile ? (
        <SideSheet
          className="app-nav-drawer"
          title={SYSTEM_NAME}
          placement="left"
          width={240}
          visible={mobileNavOpen}
          footer={null}
          onCancel={() => setMobileNavOpen(false)}
        >
          <SideMenu {...menuProps} />
        </SideSheet>
      ) : null}
    </>
  );
}
