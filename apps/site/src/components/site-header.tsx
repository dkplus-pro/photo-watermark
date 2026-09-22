import "@arco-design/web-react/es/_util/react-19-adapter";
import { Button, Drawer, Menu } from "@arco-design/web-react";
import { IconMenu } from "@arco-design/web-react/icon";
import { Link } from "@modern-js/runtime/router";
import { useCallback } from "react";

import { NAV_ITEMS } from "../config/site";
import { useIsMobile } from "../hooks/use-breakpoint";
import { useUiStore } from "../store/ui";
import "./site-header.css";

interface SiteHeaderProps {
  siteName: string;
  logoUrl?: string;
}

// 站点页头:站名/Logo + 导航。桌面渲染横向菜单,移动端(< 768px)折叠为汉堡按钮 + 抽屉
// (响应式双端适配要求见 docs/site.md;抽屉开合是客户端交互态,存 useUiStore)。
export default function SiteHeader({ siteName, logoUrl }: SiteHeaderProps) {
  const isMobile = useIsMobile();
  const mobileMenuOpen = useUiStore((state) => state.mobileMenuOpen);
  const setMobileMenuOpen = useUiStore((state) => state.setMobileMenuOpen);

  const handleMenuClick = useCallback(() => setMobileMenuOpen(false), [setMobileMenuOpen]);

  const brand = (
    <Link to="/" className="site-brand" aria-label={siteName}>
      {logoUrl ? <img className="site-logo" src={logoUrl} alt={siteName} /> : null}
      <span className="site-name">{siteName}</span>
    </Link>
  );

  return (
    <header className="site-header">
      <div className="site-header-inner">
        {brand}
        {isMobile ? (
          <Button
            className="site-mobile-trigger"
            type="text"
            icon={<IconMenu />}
            aria-label={mobileMenuOpen ? "关闭导航" : "打开导航"}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          />
        ) : (
          <Menu className="site-nav" mode="horizontal" selectedKeys={["/"]}>
            {NAV_ITEMS.map((item) => (
              <Menu.Item key={item.path}>
                <Link to={item.path}>{item.label}</Link>
              </Menu.Item>
            ))}
          </Menu>
        )}
      </div>
      {/* 抽屉仅移动端触发;Arco Drawer 关闭态不渲染内容,SSR 输出不受影响。 */}
      <Drawer
        visible={mobileMenuOpen}
        placement="top"
        headerStyle={{ display: "none" }}
        bodyStyle={{ padding: 0 }}
        onCancel={handleMenuClick}
      >
        <Menu
          mode="vertical"
          selectedKeys={["/"]}
          style={{ width: "100%" }}
          onClickMenuItem={handleMenuClick}
        >
          {NAV_ITEMS.map((item) => (
            <Menu.Item key={item.path}>
              <Link to={item.path}>{item.label}</Link>
            </Menu.Item>
          ))}
        </Menu>
      </Drawer>
    </header>
  );
}
