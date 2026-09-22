import { Message, Modal, Select } from "@arco-design/web-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { UserItem } from "../../../../api/generated/cMSAdminAPI.schemas";
import { RolesController, UsersController } from "../../../../api/controllers.gen";
import { queryKeys } from "../../../../api/queryKeys";

// 给用户分配角色弹窗(简单表单:Modal + Select)。
export function UserRolesModal({
  visible,
  user,
  onClose
}: {
  visible: boolean;
  user: UserItem | null;
  onClose: () => void;
}) {
  const [roleIds, setRoleIds] = useState<number[]>(user?.roleIds ?? []);
  // 回填:每次打开时以该用户已绑定的角色初始化选中项。
  useEffect(() => {
    if (visible) {
      setRoleIds(user?.roleIds ?? []);
    }
  }, [visible, user]);
  const queryClient = useQueryClient();

  const rolesQuery = useQuery({
    queryKey: queryKeys.roles.all,
    queryFn: () => RolesController.listAllRoles(),
    enabled: visible
  });

  const saveMutation = useMutation({
    mutationFn: () => UsersController.updateUserRoles(user?.id ?? 0, { roleIds }),
    onSuccess: () => {
      Message.success("角色已分配");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      onClose();
    }
  });

  const options = (rolesQuery.data ?? []).map((role) => ({
    label: `${role.name}(${role.code})`,
    value: role.id
  }));

  return (
    <Modal
      title={`分配角色:${user?.nickname ?? ""}`}
      visible={visible}
      onOk={() => saveMutation.mutate()}
      confirmLoading={saveMutation.isPending}
      onCancel={onClose}
      unmountOnExit
    >
      <Select
        mode="multiple"
        placeholder="选择角色"
        style={{ width: "100%" }}
        options={options}
        value={roleIds}
        onChange={(value) => setRoleIds(value)}
        loading={rolesQuery.isPending}
      />
    </Modal>
  );
}
