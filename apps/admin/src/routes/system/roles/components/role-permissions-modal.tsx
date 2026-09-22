import { Message, Modal, Tree } from "@arco-design/web-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { RoleItem } from "../../../../api/generated/cMSAdminAPI.schemas";
import { PermissionsController, RolesController } from "../../../../api/controllers.gen";
import { queryKeys } from "../../../../api/queryKeys";

// 权限树:菜单权限点为根节点,API 权限点挂在其所属模块的菜单点下(见 docs/api-pages.md)。
export function RolePermissionsModal({
  visible,
  role,
  onClose
}: {
  visible: boolean;
  role: RoleItem | null;
  onClose: () => void;
}) {
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  // 回填:每次打开时以角色已有的权限点初始化勾选。
  useEffect(() => {
    if (visible) {
      setCheckedKeys((role?.permissionIds ?? []).map(String));
    }
  }, [visible, role]);
  const queryClient = useQueryClient();

  const treeQuery = useQuery({
    queryKey: queryKeys.permissions.tree,
    queryFn: () => PermissionsController.listPermissions(),
    enabled: visible
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      RolesController.updateRolePermissions(role?.id ?? 0, {
        permissionIds: checkedKeys.map((key) => Number(key)).filter((id) => Number.isInteger(id))
      }),
    onSuccess: () => {
      Message.success("权限已分配");
      void queryClient.invalidateQueries({ queryKey: ["roles"] });
      onClose();
    }
  });

  const treeData = (treeQuery.data ?? []).map((node) => toTreeNode(node));

  return (
    <Modal
      title={`分配权限:${role?.name ?? ""}`}
      visible={visible}
      onOk={() => saveMutation.mutate()}
      confirmLoading={saveMutation.isPending}
      onCancel={onClose}
      unmountOnExit
    >
      <Tree
        checkable
        checkedKeys={checkedKeys}
        onCheck={(value) => setCheckedKeys(value as string[])}
        treeData={treeData}
      />
    </Modal>
  );
}

interface ApiPermissionNode {
  id: number;
  code: string;
  name: string;
  children: ApiPermissionNode[];
}

interface TreeNode {
  key: string;
  title: string;
  children: TreeNode[];
}

function toTreeNode(node: ApiPermissionNode): TreeNode {
  return {
    key: String(node.id),
    title: `${node.name}(${node.code})`,
    children: node.children.map(toTreeNode)
  };
}
