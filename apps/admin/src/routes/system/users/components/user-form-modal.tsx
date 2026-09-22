import { Form, Input, Message, Modal } from "@arco-design/web-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { UserItem } from "../../../../api/generated/cMSAdminAPI.schemas";
import { UsersController } from "../../../../api/controllers.gen";

// 新建/编辑用户弹窗(简单表单:Modal + Form,见 docs/admin.md 表单范式)。
export function UserFormModal({
  visible,
  editing,
  onClose
}: {
  visible: boolean;
  editing: UserItem | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (values: {
      username?: string;
      password?: string;
      nickname?: string;
      email?: string;
    }) => {
      if (editing) {
        return UsersController.updateUser(editing.id, { nickname: values.nickname ?? "" });
      }
      return UsersController.createUser({
        username: values.username ?? "",
        password: values.password ?? "",
        nickname: values.nickname,
        email: values.email
      });
    },
    onSuccess: () => {
      Message.success(editing ? "用户已更新" : "用户已创建");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      onClose();
    }
  });

  const handleOk = async () => {
    try {
      const values = await form.validate();
      saveMutation.mutate(values);
    } catch {
      // 校验失败,表单内已显示错误信息。
    }
  };

  return (
    <Modal
      title={editing ? "编辑用户" : "新建用户"}
      visible={visible}
      onOk={handleOk}
      confirmLoading={saveMutation.isPending}
      onCancel={onClose}
      unmountOnExit
    >
      <Form form={form} layout="vertical" initialValues={editing ?? {}}>
        <Form.Item
          field="username"
          label="用户名"
          rules={[{ required: !editing, message: "请输入用户名" }]}
        >
          <Input placeholder="登录名" disabled={Boolean(editing)} maxLength={64} />
        </Form.Item>
        {!editing ? (
          <Form.Item
            field="password"
            label="初始密码"
            rules={[
              { required: true, message: "请输入初始密码" },
              { minLength: 6, message: "至少 6 位" }
            ]}
          >
            <Input.Password placeholder="初始密码" maxLength={64} />
          </Form.Item>
        ) : null}
        <Form.Item
          field="nickname"
          label="昵称"
          rules={[{ required: true, message: "请输入昵称" }]}
        >
          <Input placeholder="显示名" maxLength={64} />
        </Form.Item>
        <Form.Item field="email" label="邮箱">
          <Input placeholder="email@example.com" maxLength={128} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
