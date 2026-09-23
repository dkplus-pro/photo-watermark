// React 19 下 Arco 的命令式 API(Message/Notification 等)必须先启用官方 react-19 适配器,
// 否则内部走已移除的 ReactDOM.render 报错(见 @arco-design/web-react es/_util/react-19-adapter)。
import "@arco-design/web-react/es/_util/react-19-adapter";
import { ConfigProvider, Drawer, Layout as ArcoLayout, Menu } from "@arco-design/web-react";
import { IconMenuFold, IconMenuUnfold } from "@arco-design/web-react/icon";
import zhCN from "@arco-design/web-react/es/locale/zh-CN";
import { Outlet, useLocation, useNavigate } from "@modern-js/runtime/router";
import { useState } from "react";

import AppFooter from "../components/app-footer";
import AuthorQrcodeFloat from "../components/author-qrcode-float";
import ErrorBoundary from "../components/error-boundary";
import { sidebarMenus } from "../config/menu";
import { APP_BASENAME, SYSTEM_NAME } from "../constants";
import { useIsMobile } from "../hooks/use-responsive";
import { useUiStore } from "../store/ui";
import { assetUrl } from "../utils/asset-url";

// 样式引入顺序硬要求:arco 基础样式 → 芥子主题覆盖层(D13)→ 壳层自定义样式。
import "@arco-design/web-react/dist/css/arco.css";
import "@arco-themes/react-juzi001/theme.css";
import "./index.css";

const { Sider, Header, Content } = ArcoLayout;

// 全局根布局:本站无鉴权、无服务端状态,壳层只做导航骨架与响应式切换。
// 根级 ErrorBoundary 兜住壳层渲染错误,页面级 ErrorBoundary 兜住 Outlet 内错误(见阶段 9B)。
export default function Layout() {
  return (
    <ConfigProvider locale={zhCN}>
      <ErrorBoundary>
        <AppShell />
      </ErrorBoundary>
    </ConfigProvider>
  );
}

interface SideMenuProps {
  appPathname: string;
  openKeys: string[];
  collapse?: boolean;
  onOpenKeysChange: (openKeys: string[]) => void;
  onNavigate: (key: string) => void;
}

// 菜单渲染只此一份实现:桌面 Sider 与移动 Drawer 复用同一组件,
// 选中态与展开态由壳层持有,避免两处 Menu 的状态各自分裂。
function SideMenu({
  appPathname,
  openKeys,
  collapse,
  onOpenKeysChange,
  onNavigate
}: SideMenuProps) {
  return (
    <Menu
      selectedKeys={[appPathname]}
      openKeys={openKeys}
      collapse={collapse}
      // 当前 Arco 版本(2.66)受控展开的回调是 onClickSubMenu(第二参即最新 openKeys),
      // 修复受控模式下点击目录展开/收起失效的问题(阶段 9A)。
      onClickSubMenu={(_, nextOpenKeys) => onOpenKeysChange(nextOpenKeys)}
      onClickMenuItem={(key) => onNavigate(key)}
      style={{ width: "100%" }}
    >
      {sidebarMenus.map((node) =>
        node.children?.length ? (
          <Menu.SubMenu
            key={node.path}
            title={
              <>
                {node.icon}
                <span>{node.title}</span>
              </>
            }
          >
            {node.children.map((child) => (
              <Menu.Item key={child.path} renderItemInTooltip={() => child.title}>
                {child.icon}
                <span>{child.title}</span>
              </Menu.Item>
            ))}
          </Menu.SubMenu>
        ) : (
          <Menu.Item key={node.path} renderItemInTooltip={() => node.title}>
            {node.icon}
            <span>{node.title}</span>
          </Menu.Item>
        )
      )}
    </Menu>
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
      <ArcoLayout className="app-shell">
        {/* 移动端不渲染 Sider,同一份菜单改由左侧 Drawer 承载(D12),避免两份 Menu 并存。 */}
        {!isMobile ? (
          <Sider className="app-sider" width={220} collapsedWidth={60} collapsed={siderCollapsed}>
            <div className="app-logo">
              {siderCollapsed ? (
                SYSTEM_NAME.slice(0, 1)
              ) : (
                <>
                  {/* public 资源必须经 assetUrl 拼 basePath,裸 `/assets/...` 在子路径部署下 404。 */}
                  <img className="app-logo-img" src={assetUrl("assets/brand/logo.png")} alt="" />
                  {SYSTEM_NAME}
                </>
              )}
            </div>
            <div
              className="app-sider-trigger"
              role="button"
              aria-label={siderCollapsed ? "展开侧边栏" : "收起侧边栏"}
              onClick={toggleSider}
            >
              {siderCollapsed ? <IconMenuUnfold /> : <IconMenuFold />}
            </div>
            <SideMenu {...menuProps} collapse={siderCollapsed} />
          </Sider>
        ) : null}
        <ArcoLayout className="app-main">
          {/* 顶栏:移动端左侧汉堡按钮开抽屉,右侧只放应用名(无用户区,本站无登录)。 */}
          <Header className="app-header">
            {isMobile ? (
              <span
                className="app-nav-trigger"
                role="button"
                aria-label={mobileNavOpen ? "关闭导航" : "打开导航"}
                onClick={() => setMobileNavOpen(!mobileNavOpen)}
              >
                {mobileNavOpen ? <IconMenuUnfold /> : <IconMenuFold />}
              </span>
            ) : null}
            <div className="app-header-right">{SYSTEM_NAME}</div>
          </Header>
          <Content className="app-content">
            {/* 页面级 ErrorBoundary:页面崩溃时侧边栏/顶栏仍可用。 */}
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </Content>
          <AppFooter />
        </ArcoLayout>
      </ArcoLayout>
      <AuthorQrcodeFloat />
      {isMobile ? (
        <Drawer
          className="app-nav-drawer"
          title={SYSTEM_NAME}
          placement="left"
          width={240}
          visible={mobileNavOpen}
          footer={null}
          onCancel={() => setMobileNavOpen(false)}
        >
          <SideMenu {...menuProps} />
        </Drawer>
      ) : null}
    </>
  );
}
