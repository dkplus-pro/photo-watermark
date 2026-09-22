import {
  Button,
  Card,
  Form,
  Input,
  Message,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag
} from "@arco-design/web-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { UserItem } from "../../../api/generated/cMSAdminAPI.schemas";
import { UsersController } from "../../../api/controllers.gen";
import { queryKeys } from "../../../api/queryKeys";
import AuthGate from "../../../components/auth-gate";
import PageContainer from "../../../components/page-container";
import { useTableQuery } from "../../../hooks/use-table-query";

import { UserFormModal } from "./components/user-form-modal";
import { UserRolesModal } from "./components/user-roles-modal";

// 查询条件(提交后才生效,见 docs/admin.md 列表页范式)。
interface UserFilters {
  keyword?: string;
  status?: boolean;
}

interface UserQueryValues {
  keyword?: string;
  status?: number;
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<UserQueryValues>();
  const [filters, setFilters] = useState<UserFilters>({});
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [rolesUser, setRolesUser] = useState<UserItem | null>(null);

  const { page, pageSize, pagination, resetPage, setTotal } = useTableQuery();

  const listQuery = useQuery({
    queryKey: queryKeys.users.list(page, pageSize, filters.keyword ?? "", filters.status),
    queryFn: () =>
      UsersController.listUsers({
        page,
        pageSize,
        keyword: filters.keyword || undefined,
        status: filters.status
      })
  });

  useEffect(() => {
    setTotal(listQuery.data?.total ?? 0);
  }, [listQuery.data?.total, setTotal]);

  const statusMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      UsersController.updateUserStatus(id, { status: enabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["users"] })
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => UsersController.deleteUser(id),
    onSuccess: () => {
      Message.success("用户已删除");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    }
  });

  const deleteUser = (record: UserItem) => {
    Modal.confirm({
      title: "删除确认",
      content: `确定删除用户 ${record.username} 吗?`,
      onOk: () => deleteMutation.mutateAsync(record.id)
    });
  };

  const handleSearch = (values: UserQueryValues) => {
    setFilters({
      keyword: values.keyword?.trim() || undefined,
      status: values.status === undefined ? undefined : values.status === 1
    });
    resetPage();
  };

  const handleReset = () => {
    form.resetFields();
    setFilters({});
    resetPage();
  };

  const columns = [
    { title: "ID", dataIndex: "id", width: 70 },
    { title: "用户名", dataIndex: "username" },
    { title: "昵称", dataIndex: "nickname" },
    { title: "邮箱", dataIndex: "email" },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (_: unknown, record: UserItem) => (
        <AuthGate permission="system:user:update">
          <Switch
            checked={record.status}
            disabled={record.isBuiltin}
            onChange={(enabled) => statusMutation.mutate({ id: record.id, enabled })}
          />
        </AuthGate>
      )
    },
    {
      title: "内置",
      dataIndex: "isBuiltin",
      width: 90,
      render: (value: boolean) => (value ? <Tag color="arcoblue">内置</Tag> : null)
    },
    {
      title: "操作",
      width: 230,
      render: (_: unknown, record: UserItem) => (
        <Space>
          <AuthGate permission="system:user:update">
            <Button
              size="mini"
              onClick={() => {
                setEditing(record);
                setFormVisible(true);
              }}
            >
              编辑
            </Button>
          </AuthGate>
          <AuthGate permission="system:user:assign">
            <Button size="mini" onClick={() => setRolesUser(record)}>
              分配角色
            </Button>
          </AuthGate>
          <AuthGate permission="system:user:delete">
            <Button
              size="mini"
              status="danger"
              disabled={record.isBuiltin}
              onClick={() => deleteUser(record)}
            >
              删除
            </Button>
          </AuthGate>
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
            <Input placeholder="用户名/昵称" allowClear style={{ width: 200 }} />
          </Form.Item>
          <Form.Item field="status" label="状态">
            <Select
              placeholder="请选择"
              allowClear
              style={{ width: 120 }}
              options={[
                { label: "启用", value: 1 },
                { label: "禁用", value: 0 }
              ]}
            />
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
          <AuthGate permission="system:user:create">
            <Button
              type="primary"
              onClick={() => {
                setEditing(null);
                setFormVisible(true);
              }}
            >
              新建用户
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

      <UserFormModal
        visible={formVisible}
        editing={editing}
        onClose={() => {
          setFormVisible(false);
          setEditing(null);
        }}
      />
      <UserRolesModal
        visible={rolesUser !== null}
        user={rolesUser}
        onClose={() => setRolesUser(null)}
      />
    </PageContainer>
  );
}
