import { Form, Input, Message, Modal } from "@arco-design/web-react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@modern-js/runtime/router";

import { AuthController } from "../api/controllers.gen";
import { useAuthStore } from "../store/auth";

interface PasswordModalProps {
  visible: boolean;
  onClose: () => void;
}

interface PasswordValues {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

// 修改密码弹窗(顶栏用户下拉入口)。成功后强制重新登录(服务端不失效旧 token,见 docs/mvp-plan.md)。
export default function PasswordModal({ visible, onClose }: PasswordModalProps) {
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const changeMutation = useMutation({
    mutationFn: (values: PasswordValues) =>
      AuthController.changePassword({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword
      }),
    onSuccess: () => {
      Message.success("密码已修改,请重新登录");
      useAuthStore.getState().clear();
      onClose();
      navigate("/login", { replace: true });
    }
  });

  const handleOk = async () => {
    try {
      const values = (await form.validate()) as PasswordValues;
      changeMutation.mutate(values);
    } catch {
      // 校验失败,表单内已显示错误信息。
    }
  };

  return (
    <Modal
      title="修改密码"
      visible={visible}
      onOk={handleOk}
      confirmLoading={changeMutation.isPending}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      maskClosable={false}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          field="oldPassword"
          label="旧密码"
          rules={[{ required: true, message: "请输入旧密码" }]}
        >
          <Input.Password placeholder="旧密码" maxLength={64} />
        </Form.Item>
        <Form.Item
          field="newPassword"
          label="新密码"
          rules={[
            { required: true, message: "请输入新密码" },
            { minLength: 6, message: "至少 6 位" }
          ]}
        >
          <Input.Password placeholder="新密码" maxLength={64} />
        </Form.Item>
        <Form.Item
          field="confirmPassword"
          label="确认新密码"
          rules={[
            { required: true, message: "请再次输入新密码" },
            {
              validator: (value, callback) => {
                const newPassword = form.getFieldValue("newPassword");
                if (value !== newPassword) {
                  callback("两次输入的密码不一致");
                } else {
                  callback();
                }
              }
            }
          ]}
        >
          <Input.Password placeholder="确认新密码" maxLength={64} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
