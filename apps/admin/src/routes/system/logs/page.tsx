import {
  Button,
  Card,
  DatePicker,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag
} from "@arco-design/web-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type {
  ListOperationLogsStatus,
  OperationLogItem
} from "../../../api/generated/cMSAdminAPI.schemas";
import { LogsController } from "../../../api/controllers.gen";
import { queryKeys } from "../../../api/queryKeys";
import PageContainer from "../../../components/page-container";
import { useTableQuery } from "../../../hooks/use-table-query";

// 查询条件(提交后才生效,见 docs/admin.md 列表页范式)。
interface LogFilters {
  username?: string;
  resource?: string;
  action?: string;
  status?: ListOperationLogsStatus;
  range?: [string, string];
}

interface LogQueryValues {
  username?: string;
  resource?: string;
  action?: string;
  status?: ListOperationLogsStatus;
  range?: string[];
}

// 业务操作日志:只读查询页(谁在什么时间对什么对象做了什么、结果如何),给运营查看。
// HTTP 访问日志不入库、只写服务器文件(见 docs/mvp-plan.md 阶段 4 修订)。
export default function LogsPage() {
  const [form] = Form.useForm<LogQueryValues>();
  const [filters, setFilters] = useState<LogFilters>({});
  const [detail, setDetail] = useState<OperationLogItem | null>(null);

  const { page, pageSize, pagination, resetPage, setTotal } = useTableQuery();

  const listQuery = useQuery({
    queryKey: queryKeys.logs.list(
      page,
      pageSize,
      filters.username ?? "",
      filters.resource,
      filters.action,
      filters.status,
      filters.range
    ),
    queryFn: () =>
      LogsController.listOperationLogs({
        page,
        pageSize,
        username: filters.username || undefined,
        resource: filters.resource,
        action: filters.action || undefined,
        status: filters.status,
        startTime: filters.range?.[0],
        endTime: filters.range?.[1]
      })
  });

  useEffect(() => {
    setTotal(listQuery.data?.total ?? 0);
  }, [listQuery.data?.total, setTotal]);

  const toIso = (value: string) => new Date(value).toISOString();

  const handleSearch = (values: LogQueryValues) => {
    const start = values.range?.[0];
    const end = values.range?.[1];
    setFilters({
      username: values.username?.trim() || undefined,
      resource: values.resource,
      action: values.action?.trim() || undefined,
      status: values.status,
      range: start && end ? [toIso(start), toIso(end)] : undefined
    });
    resetPage();
  };

  const handleReset = () => {
    form.resetFields();
    setFilters({});
    resetPage();
  };

  const columns = [
    { title: "操作人", dataIndex: "username", width: 110 },
    { title: "动作", dataIndex: "action", width: 180 },
    {
      title: "资源",
      dataIndex: "resource",
      width: 120,
      render: (value: string, record: OperationLogItem) =>
        record.resourceId ? `${value}:${record.resourceId}` : value
    },
    { title: "描述", dataIndex: "description" },
    {
      title: "结果",
      dataIndex: "status",
      width: 90,
      render: (value: string) =>
        value === "success" ? <Tag color="green">成功</Tag> : <Tag color="red">失败</Tag>
    },
    { title: "IP", dataIndex: "ip", width: 130 },
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 170,
      render: (value: string) => new Date(value).toLocaleString("zh-CN")
    },
    {
      title: "操作",
      width: 80,
      render: (_: unknown, record: OperationLogItem) => (
        <Button size="mini" onClick={() => setDetail(record)}>
          详情
        </Button>
      )
    }
  ];

  return (
    <PageContainer>
      <Card>
        {/* 查询区:Form + 查询/重置(arco-pro search-table 范式)。 */}
        <Form form={form} layout="inline" onSubmit={handleSearch}>
          <Form.Item field="username" label="操作人">
            <Input placeholder="操作人" allowClear style={{ width: 140 }} />
          </Form.Item>
          <Form.Item field="action" label="动作">
            <Input placeholder="如 user.delete" allowClear style={{ width: 160 }} />
          </Form.Item>
          <Form.Item field="resource" label="资源">
            <Select
              placeholder="请选择"
              allowClear
              style={{ width: 120 }}
              options={["user", "role", "config", "dict", "dictEntry"].map((value) => ({
                label: value,
                value
              }))}
            />
          </Form.Item>
          <Form.Item field="status" label="结果">
            <Select
              placeholder="请选择"
              allowClear
              style={{ width: 100 }}
              options={[
                { label: "成功", value: "success" },
                { label: "失败", value: "failed" }
              ]}
            />
          </Form.Item>
          <Form.Item field="range" label="时间" getValueFromEvent={(dateString) => dateString}>
            <DatePicker.RangePicker showTime style={{ width: 360 }} />
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

        <Table
          rowKey="id"
          loading={listQuery.isPending}
          columns={columns}
          data={listQuery.data?.list ?? []}
          pagination={pagination}
          style={{ marginTop: 16 }}
        />
      </Card>

      <Drawer
        width={480}
        visible={detail !== null}
        onCancel={() => setDetail(null)}
        footer={null}
        title="日志详情"
      >
        {detail ? (
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <DetailRow label="操作人" value={detail.username || "(未登录)"} />
            <DetailRow label="动作" value={detail.action} />
            <DetailRow
              label="资源"
              value={
                detail.resourceId ? `${detail.resource}:${detail.resourceId}` : detail.resource
              }
            />
            <DetailRow label="结果" value={detail.status === "success" ? "成功" : "失败"} />
            <DetailRow label="IP" value={detail.ip || "-"} />
            <DetailRow label="时间" value={new Date(detail.createdAt).toLocaleString("zh-CN")} />
            <DetailRow label="描述" value={detail.description} />
          </Space>
        ) : null}
      </Drawer>
    </PageContainer>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Space style={{ justifyContent: "space-between", width: "100%" }}>
      <span style={{ color: "#86909c" }}>{label}</span>
      <span>{value}</span>
    </Space>
  );
}
