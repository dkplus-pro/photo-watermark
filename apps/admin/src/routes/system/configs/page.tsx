import { Button, Card, Form, Input, Message, Space } from "@arco-design/web-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { ConfigItem } from "../../../api/generated/cMSAdminAPI.schemas";
import { ConfigsController } from "../../../api/controllers.gen";
import { queryKeys } from "../../../api/queryKeys";
import PageContainer from "../../../components/page-container";

// 系统配置:复杂表单页范例(UI 规范见 docs/admin.md 表单范式)——
// PageContainer + Card 分组(站点信息一组)+ 底部固定操作栏,后续新表单页照此。
// 存储配置属运维项,已迁环境变量(.env.local,改后重启生效),不再是配置组(见 docs/mvp-plan.md 阶段 6)。
export default function ConfigsPage() {
  return (
    <PageContainer>
      <SiteConfigForm group="system" />
    </PageContainer>
  );
}

function SiteConfigForm({ group }: { group: "system" }) {
  const [form] = Form.useForm<Record<string, string>>();
  const queryClient = useQueryClient();

  const groupQuery = useQuery({
    queryKey: queryKeys.configs.group(group),
    queryFn: () => ConfigsController.getConfig(group)
  });

  // 查询成功后回填表单(服务端状态同步,非 useEffect 手动拉接口)。
  useEffect(() => {
    if (groupQuery.data) {
      form.setFieldsValue(
        Object.fromEntries(
          (groupQuery.data.items ?? []).map((item) => [item.key, item.value ?? ""])
        )
      );
    }
  }, [groupQuery.data, form]);

  const saveMutation = useMutation({
    mutationFn: (items: ConfigItem[]) => ConfigsController.updateConfig(group, { items }),
    onSuccess: () => {
      Message.success("配置已保存");
      void queryClient.invalidateQueries({ queryKey: ["configs"] });
    }
  });

  const items = groupQuery.data?.items ?? [];

  const handleSubmit = (values: Record<string, string>) => {
    saveMutation.mutate(
      items.map((item) => ({ key: item.key, value: values[item.key] ?? "", remark: item.remark }))
    );
  };

  const handleReset = () => {
    form.setFieldsValue(Object.fromEntries(items.map((item) => [item.key, item.value ?? ""])));
  };

  return (
    <Form form={form} layout="vertical" onSubmit={handleSubmit} className="form-page">
      <Card title="站点信息">
        {items.map((item) => (
          <Form.Item
            key={item.key}
            field={item.key}
            label={item.remark || item.key}
            tooltip={item.remark ? item.key : undefined}
          >
            <Input placeholder={item.key} />
          </Form.Item>
        ))}
      </Card>
      {/* 底部固定操作栏(arco-pro form/group 范式)。 */}
      <div className="form-footer-bar">
        <Space>
          <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
            保存
          </Button>
          <Button onClick={handleReset}>重置</Button>
        </Space>
      </div>
    </Form>
  );
}
