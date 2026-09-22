import {
  Button,
  Card,
  Form,
  Input,
  Message,
  Modal,
  Space,
  Switch,
  Table,
  Tag
} from "@arco-design/web-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { RoleItem } from "../../../api/generated/cMSAdminAPI.schemas";
import { RolesController } from "../../../api/controllers.gen";
import { queryKeys } from "../../../api/queryKeys";
import AuthGate from "../../../components/auth-gate";
import PageContainer from "../../../components/page-container";
import { useTableQuery } from "../../../hooks/use-table-query";

import { RoleFormModal } from "./components/role-form-modal";
import { RolePermissionsModal } from "./components/role-permissions-modal";

// 查询条件(提交后才生效,见 docs/admin.md 列表页范式)。
interface RoleFilters {
  keyword?: string;
}

interface RoleQueryValues {
  keyword?: string;
}

export default function RolesPage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<RoleQueryValues>();
  const [filters, setFilters] = useState<RoleFilters>({});
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<RoleItem | null>(null);
  const [permissionsRole, setPermissionsRole] = useState<RoleItem | null>(null);

  const { page, pageSize, pagination, resetPage, setTotal } = useTableQuery();

  const listQuery = useQuery({
    queryKey: queryKeys.roles.list(page, pageSize, filters.keyword ?? ""),
    queryFn: () =>
      RolesController.listRoles({ page, pageSize, keyword: filters.keyword || undefined })
  });

  useEffect(() => {
    setTotal(listQuery.data?.total ?? 0);
  }, [listQuery.data?.total, setTotal]);

  const statusMutation = useMutation({
    mutationFn: ({ id, enabled, role }: { id: number; enabled: boolean; role: RoleItem }) =>
      RolesController.updateRole(id, {
        code: role.code,
        name: role.name,
        remark: role.remark,
        status: enabled
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["roles"] })
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => RolesController.deleteRole(id),
    onSuccess: () => {
      Message.success("角色已删除");
      void queryClient.invalidateQueries({ queryKey: ["roles"] });
    }
  });

  const deleteRole = (record: RoleItem) => {
    Modal.confirm({
      title: "删除确认",
      content: `确定删除角色 ${record.name} 吗?`,
      onOk: () => deleteMutation.mutateAsync(record.id)
    });
  };

  const handleSearch = (values: RoleQueryValues) => {
    setFilters({ keyword: values.keyword?.trim() || undefined });
    resetPage();
  };

  const handleReset = () => {
    form.resetFields();
    setFilters({});
    resetPage();
  };

  const columns = [
    { title: "ID", dataIndex: "id", width: 70 },
    { title: "编码", dataIndex: "code" },
    { title: "名称", dataIndex: "name" },
    { title: "备注", dataIndex: "remark" },
    {
      title: "内置",
      dataIndex: "isBuiltin",
      width: 90,
      render: (value: boolean) => (value ? <Tag color="arcoblue">内置</Tag> : null)
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (_: unknown, record: RoleItem) => (
        <AuthGate permission="system:role:update">
          <Switch
            checked={record.status}
            disabled={record.isBuiltin}
            onChange={(enabled) => statusMutation.mutate({ id: record.id, enabled, role: record })}
          />
        </AuthGate>
      )
    },
    {
      title: "操作",
      width: 230,
      render: (_: unknown, record: RoleItem) => (
        <Space>
          <Button
            size="mini"
            onClick={() => {
              setEditing(record);
              setFormVisible(true);
            }}
          >
            编辑
          </Button>
          <Button size="mini" onClick={() => setPermissionsRole(record)}>
            分配权限
          </Button>
          <Button
            size="mini"
            status="danger"
            disabled={record.isBuiltin}
            onClick={() => deleteRole(record)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <PageContainer>
      <Card>
        {/* 查询区:Form + 查询/重置(arco-pro search-table 范式)。 */}
        <Form form={form} layout="inline" onSubmit={handleSearch}>
          <Form.Item field="keyword" label="关键词">
            <Input placeholder="角色编码/名称" allowClear style={{ width: 200 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={listQuery.isPending}>
                查询
              </Button>
              <Button onClick={handleReset}>重置</Button>
            </Space>
          </Form.Item>
        </Form>
        <div style={{ margin: "16px 0", textAlign: "right" }}>
          <AuthGate permission="system:role:create">
            <Button
              type="primary"
              onClick={() => {
                setEditing(null);
                setFormVisible(true);
              }}
            >
              新建角色
            </Button>
          </AuthGate>
        </div>
        <Table
          rowKey="id"
          loading={listQuery.isPending}
          columns={columns}
          data={listQuery.data?.list ?? []}
          pagination={pagination}
        />
      </Card>

      <RoleFormModal
        visible={formVisible}
        editing={editing}
        onClose={() => {
          setFormVisible(false);
          setEditing(null);
        }}
      />
      <RolePermissionsModal
        visible={permissionsRole !== null}
        role={permissionsRole}
        onClose={() => setPermissionsRole(null)}
      />
    </PageContainer>
  );
}
