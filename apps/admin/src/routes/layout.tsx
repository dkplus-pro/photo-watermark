// React 19 下 Arco 的命令式 API(Message/Notification 等)必须先启用官方 react-19 适配器,
// 否则内部走已移除的 ReactDOM.render 报错(见 @arco-design/web-react es/_util/react-19-adapter)。
import "@arco-design/web-react/es/_util/react-19-adapter";
import {
  Avatar,
  ConfigProvider,
  Dropdown,
  Layout as ArcoLayout,
  Menu,
  Space
} from "@arco-design/web-react";
import { IconDown, IconMenuFold, IconMenuUnfold, IconUser } from "@arco-design/web-react/icon";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import zhCN from "@arco-design/web-react/es/locale/zh-CN";
import { Navigate, Outlet, useLocation, useNavigate } from "@modern-js/runtime/router";
import { useEffect, useMemo, useRef, useState } from "react";

import AppFooter from "../components/app-footer";
import ErrorBoundary from "../components/error-boundary";

import { AuthController } from "../api/controllers.gen";
import { queryKeys } from "../api/queryKeys";
import { filterMenusByPermissions, sidebarMenus } from "../config/menu";
import { queryClient } from "../config/queryClient";
import { APP_BASENAME, SYSTEM_NAME } from "../constants";
import { useAuthStore } from "../store/auth";

import PasswordModal from "../components/password-modal";
import "@arco-design/web-react/dist/css/arco.css";
import "./index.css";

const { Sider, Header, Content } = ArcoLayout;

// 全局根布局:Provider 必须在调用 useQuery 的组件之上,壳与守卫都放在 AppShell。
// 根级 ErrorBoundary 放在 Provider 之下、壳之上,兜住壳层渲染错误(见 docs/admin-enhancement-plan.md 阶段 9B)。
export default function Layout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={zhCN}>
        <ErrorBoundary>
          <AppShell />
        </ErrorBoundary>
      </ConfigProvider>
    </QueryClientProvider>
  );
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeQueryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  // 侧边栏整栏折叠(UI 规范见 docs/admin.md):折叠宽度 60,折叠态仅图标 + Tooltip。
  const [siderCollapsed, setSiderCollapsed] = useState(false);

  // 应用内路径 = 剥离 basename 后的剩余段(URL /admin/{页面} 对应路由 {页面})。
  // 路由匹配(navigate/menu key/面包屑)全程用应用内路径,basename 由 router 统一叠加。
  const appPathname = location.pathname.startsWith(APP_BASENAME)
    ? location.pathname.slice(APP_BASENAME.length) || "/"
    : location.pathname;
  const isLoginPage = appPathname === "/login";

  const meQuery = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => AuthController.getMe(),
    enabled: Boolean(token) && !isLoginPage
  });

  // 当前用户信息属于服务端状态,查询成功后同步进 zustand,供顶栏直接读取。
  useEffect(() => {
    if (meQuery.data) {
      useAuthStore.getState().setUser(meQuery.data);
    }
  }, [meQuery.data]);

  // 侧边栏 = 静态菜单声明 × 当前用户权限码过滤(见 docs/admin.md 阶段 3 修订方案)。
  const visibleMenus = useMemo(
    () => filterMenusByPermissions(sidebarMenus, user?.permissions),
    [user?.permissions]
  );
  // 受控展开:SubMenu 的 defaultOpenKeys 只在挂载时读一次,而权限码异步就绪会导致
  // 挂载后才出现的 SubMenu 收不起/展不开,因此用受控 openKeys + onOpenKeys 双向绑定。
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const openKeysInitializedRef = useRef(false);
  useEffect(() => {
    // 登出/切换账号(user 置空)时重置初始化标记,下次登录重新执行一次全量展开。
    if (!user?.permissions) {
      openKeysInitializedRef.current = false;
      return;
    }
    // 权限码就绪后仅在首次初始化时全量展开目录,此后展开/收起完全交给用户点击交互,
    // 避免权限变化触发 effect 时把用户手动收起的目录再次强制展开。
    if (openKeysInitializedRef.current) {
      return;
    }
    openKeysInitializedRef.current = true;
    setOpenKeys(visibleMenus.filter((node) => node.children?.length).map((node) => node.path));
  }, [user, visibleMenus]);
  // 路由守卫:未登录访问业务页跳 /login,已登录访问 /login 跳首页。
  if (isLoginPage) {
    if (token) {
      return <Navigate to="/" replace />;
    }
    return <Outlet />;
  }
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  const handleUserMenu = async (key: string) => {
    if (key === "password") {
      setPasswordModalVisible(true);
      return;
    }
    if (key === "logout") {
      try {
        await AuthController.logout();
      } finally {
        useAuthStore.getState().clear();
        routeQueryClient.clear();
        navigate("/login", { replace: true });
      }
    }
  };

  return (
    <>
      <ArcoLayout className="app-shell">
        <Sider className="app-sider" width={220} collapsedWidth={60} collapsed={siderCollapsed}>
          <div className="app-logo">{siderCollapsed ? SYSTEM_NAME.slice(0, 1) : SYSTEM_NAME}</div>
          <div
            className="app-sider-trigger"
            role="button"
            aria-label={siderCollapsed ? "展开侧边栏" : "收起侧边栏"}
            onClick={() => setSiderCollapsed((collapsed) => !collapsed)}
          >
            {siderCollapsed ? <IconMenuUnfold /> : <IconMenuFold />}
          </div>
          <Menu
            selectedKeys={[appPathname]}
            openKeys={openKeys}
            collapse={siderCollapsed}
            // 当前 Arco 版本(2.66)受控展开的回调是 onClickSubMenu(第二参即最新 openKeys),
            // 修复受控模式下点击目录展开/收起失效的问题(阶段 9A)。
            onClickSubMenu={(_, nextOpenKeys) => setOpenKeys(nextOpenKeys)}
            onClickMenuItem={(key) => navigate(key)}
            style={{ width: "100%" }}
          >
            {visibleMenus.map((node) =>
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
        </Sider>
        <ArcoLayout>
          {/* 顶栏只保留用户区;面包屑/页头由 PageContainer 放内容区顶部(UI 规范见 docs/admin.md)。 */}
          <Header className="app-header">
            <div className="app-header-right">
              <Dropdown
                position="br"
                droplist={
                  <Menu onClickMenuItem={handleUserMenu}>
                    <Menu.Item key="password">修改密码</Menu.Item>
                    <Menu.Item key="logout">退出登录</Menu.Item>
                  </Menu>
                }
              >
                <Space className="app-user">
                  <Avatar size={24}>
                    <IconUser />
                  </Avatar>
                  {user?.nickname || user?.username}
                  <IconDown />
                </Space>
              </Dropdown>
            </div>
          </Header>
          <Content className="app-content">
            {/* 页面级 ErrorBoundary:页面崩溃时侧边栏/顶栏仍可用。 */}
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </Content>
          {/* 公共页脚:版权标识;登录页走上方守卫分支直接返回,不经过本壳层。 */}
          <AppFooter />
        </ArcoLayout>
      </ArcoLayout>
      <PasswordModal
        visible={passwordModalVisible}
        onClose={() => setPasswordModalVisible(false)}
      />
    </>
  );
}
