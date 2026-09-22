import {
  Button,
  Card,
  Form,
  Input,
  Message,
  Popconfirm,
  Space,
  Table,
  Tag
} from "@arco-design/web-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { Dict } from "../../../api/generated/cMSAdminAPI.schemas";
import { DictsController } from "../../../api/controllers.gen";
import { queryKeys } from "../../../api/queryKeys";
import AuthGate from "../../../components/auth-gate";
import PageContainer from "../../../components/page-container";
import { useTableQuery } from "../../../hooks/use-table-query";

import { DictFormModal } from "./components/dict-form-modal";

interface DictQueryValues {
  keyword?: string;
}

// 字典管理:列表页 + 操作栏(编辑 / 上下线 / 删除)。
// 字典为全量接口(无服务端分页),分页由 Table 客户端切片,但 props 仍按 UI 规范全量配置。
export default function DictsPage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<DictQueryValues>();
  const [filters, setFilters] = useState<{ keyword?: string }>({});
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<Dict | null>(null);

  const { pagination, resetPage, setTotal } = useTableQuery();

  const listQuery = useQuery({
    queryKey: queryKeys.dicts.list(filters.keyword ?? ""),
    queryFn: () => DictsController.listDicts({ keyword: filters.keyword || undefined })
  });

  useEffect(() => {
    setTotal(listQuery.data?.length ?? 0);
  }, [listQuery.data, setTotal]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["dicts"] });

  const statusMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      DictsController.updateDictStatus(id, { status: enabled }),
    onSuccess: () => {
      Message.success("状态已更新");
      invalidate();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => DictsController.deleteDict(id),
    onSuccess: () => {
      Message.success("字典已删除");
      invalidate();
    }
  });

  const handleSearch = (values: DictQueryValues) => {
    setFilters({ keyword: values.keyword?.trim() || undefined });
    resetPage();
  };

  const handleReset = () => {
    form.resetFields();
    setFilters({});
    resetPage();
  };

  const columns = [
    { title: "编码", dataIndex: "code", width: 180 },
    { title: "名称", dataIndex: "name", width: 180 },
    { title: "备注", dataIndex: "remark" },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: boolean) =>
        value ? <Tag color="green">上线</Tag> : <Tag color="gray">下线</Tag>
    },
    {
      title: "操作",
      width: 300,
      render: (_: unknown, record: Dict) => (
        <Space>
          <AuthGate permission="system:dict:update">
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
          <AuthGate permission="system:dict:update">
            <Popconfirm
              title={`确定${record.status ? "下线" : "上线"}字典 ${record.name} 吗?`}
              onOk={() => statusMutation.mutateAsync({ id: record.id, enabled: !record.status })}
            >
              <Button size="mini">{record.status ? "下线" : "上线"}</Button>
            </Popconfirm>
          </AuthGate>
          <AuthGate permission="system:dict:delete">
            <Popconfirm
              title={`确定删除字典 ${record.name} 吗?字典项将一并删除。`}
              onOk={() => deleteMutation.mutateAsync(record.id)}
            >
              <Button size="mini" status="danger">
                删除
              </Button>
            </Popconfirm>
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
            <Input placeholder="编码/名称" allowClear style={{ width: 200 }} />
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
          <AuthGate permission="system:dict:create">
            <Button
              type="primary"
              onClick={() => {
                setEditing(null);
                setFormVisible(true);
              }}
            >
              新建字典
            </Button>
          </AuthGate>
        </div>
        <Table
          rowKey="id"
          loading={listQuery.isPending}
          columns={columns}
          data={listQuery.data ?? []}
          pagination={pagination}
        />
      </Card>

      <DictFormModal
        visible={formVisible}
        editing={editing}
        onClose={() => {
          setFormVisible(false);
          setEditing(null);
        }}
      />
    </PageContainer>
  );
}
