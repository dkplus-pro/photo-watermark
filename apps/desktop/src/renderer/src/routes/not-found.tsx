import { Button, Result } from "@arco-design/web-react";
import { useNavigate } from "react-router-dom";

// 404 兜底页(routes/index.tsx 的 * 通配路由,React.lazy 懒加载):Arco Result 展示,
// 仅提供返回首页动作。
export default function NotFound() {
  const navigate = useNavigate();

  return (
    <Result
      status="404"
      title="404"
      subTitle="页面不存在"
      extra={
        <Button type="primary" onClick={() => navigate("/")}>
          返回首页
        </Button>
      }
    />
  );
}
