import { Button, Result } from "@arco-design/web-react";
import { Link } from "@modern-js/runtime/router";

// 兜底路由:全站 404 页。
export default function NotFoundRoute() {
  return (
    <main className="site-notfound">
      <Result
        status="404"
        title="404"
        subTitle="页面不存在或已被移除"
        extra={
          <Link to="/">
            <Button type="primary">返回首页</Button>
          </Link>
        }
      />
    </main>
  );
}
