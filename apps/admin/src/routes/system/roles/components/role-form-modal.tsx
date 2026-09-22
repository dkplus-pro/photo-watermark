import { Form, Input, Message, Modal } from "@arco-design/web-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { RoleItem } from "../../../../api/generated/cMSAdminAPI.schemas";
import { RolesController } from "../../../../api/controllers.gen";

// 新建/编辑角色弹窗(简单表单:Modal + Form,见 docs/admin.md 表单范式)。
export function RoleFormModal({
  visible,
  editing,
  onClose
}: {
  visible: boolean;
  editing: RoleItem | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (values: { code: string; name: string; remark?: string }) => {
      if (editing) {
        return RolesController.updateRole(editing.id, {
          code: editing.isBuiltin ? editing.code : values.code,
          name: values.name,
          remark: values.remark,
          status: editing.status
        });
      }
      return RolesController.createRole({
        code: values.code,
        name: values.name,
        remark: values.remark
      });
    },
    onSuccess: () => {
      Message.success(editing ? "角色已更新" : "角色已创建");
      void queryClient.invalidateQueries({ queryKey: ["roles"] });
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
      title={editing ? "编辑角色" : "新建角色"}
      visible={visible}
      onOk={handleOk}
      confirmLoading={saveMutation.isPending}
      onCancel={onClose}
      unmountOnExit
    >
      <Form form={form} layout="vertical" initialValues={editing ?? {}}>
        <Form.Item
          field="code"
          label="编码"
          rules={[{ required: true, message: "请输入角色编码" }]}
        >
          <Input placeholder="如 ops" maxLength={64} disabled={Boolean(editing?.isBuiltin)} />
        </Form.Item>
        <Form.Item
          field="name"
          label="名称"
          rules={[{ required: true, message: "请输入角色名称" }]}
        >
          <Input placeholder="显示名" maxLength={64} />
        </Form.Item>
        <Form.Item field="remark" label="备注">
          <Input.TextArea placeholder="角色说明" maxLength={255} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
