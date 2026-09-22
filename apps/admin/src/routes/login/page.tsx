import { Button, Card, Form, Input, Typography } from "@arco-design/web-react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@modern-js/runtime/router";

import { AuthController } from "../../api/controllers.gen";
import { useAuthStore } from "../../store/auth";
import { SYSTEM_NAME } from "../../constants";

interface LoginValues {
  username: string;
  password: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const loginMutation = useMutation({
    mutationFn: (values: LoginValues) => AuthController.login(values),
    onSuccess: (data) => {
      useAuthStore.getState().setAuth(data.token, data.user);
      navigate("/", { replace: true });
    }
    // 失败提示(用户名或密码错误等)由 client.ts 拦截器统一弹出,这里不重复处理。
  });

  return (
    <main className="login-page">
      <Card className="login-card" bordered={false}>
        <Typography.Title heading={3} style={{ textAlign: "center", marginTop: 0 }}>
          {SYSTEM_NAME}
        </Typography.Title>
        <Form
          form={form}
          layout="vertical"
          onSubmit={(values: LoginValues) => loginMutation.mutate(values)}
        >
          <Form.Item
            field="username"
            label="用户名"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input placeholder="用户名" maxLength={64} />
          </Form.Item>
          <Form.Item
            field="password"
            label="密码"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password placeholder="密码" maxLength={64} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" long loading={loginMutation.isPending}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </main>
  );
}
