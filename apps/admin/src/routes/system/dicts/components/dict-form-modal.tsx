import { Button, Form, Input, Message, Modal, Switch } from "@arco-design/web-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Dict, DictEntry } from "../../../../api/generated/cMSAdminAPI.schemas";
import { DictsController } from "../../../../api/controllers.gen";

interface EntryFormValue {
  label: string;
  value: string;
  enabled?: boolean;
}

interface DictFormValues {
  code: string;
  name: string;
  remark?: string;
  entries?: EntryFormValue[];
}

// 新建/编辑共用弹窗:字典基本信息 + 字典项动态增减(Form.List,参考 arco 动态表单)。
export function DictFormModal({
  visible,
  editing,
  onClose
}: {
  visible: boolean;
  editing: Dict | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm<DictFormValues>();
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["dicts"] });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const saveMutation = useMutation({
    mutationFn: async (values: DictFormValues) => {
      let dictId = editing?.id;
      if (editing) {
        await DictsController.updateDict(editing.id, {
          code: values.code,
          name: values.name,
          remark: values.remark,
          status: editing.status
        });
      } else {
        const created = await DictsController.createDict({
          code: values.code,
          name: values.name,
          remark: values.remark
        });
        dictId = created.id;
      }
      // 字典项整组覆写:编辑保存一次全部;新建时按表单内容写入。
      // 排序即拖拽后的数组顺序,提交时按索引赋值。
      const entries = (values.entries ?? []).map((entry, index) => ({
        label: entry.label,
        value: entry.value,
        sort: index,
        status: entry.enabled ?? true
      }));
      if (dictId) {
        await DictsController.replaceDictEntries(dictId, { entries });
      }
    },
    onSuccess: () => {
      Message.success(editing ? "字典已更新" : "字典已创建");
      invalidate();
      onClose();
    }
  });

  const openWithDefault = () => {
    form.clearFields();
    if (editing) {
      form.setFieldsValue({
        code: editing.code,
        name: editing.name,
        remark: editing.remark ?? ""
      });
      // 编辑:回填基本信息,字典项从接口拉取后回填进 Form.List。
      DictsController.listDictItems(editing.code).then((entries: DictEntry[]) => {
        form.setFieldsValue({
          entries: entries.map((entry) => ({
            label: entry.label,
            value: entry.value,
            enabled: entry.status
          }))
        });
      });
    } else {
      form.setFieldsValue({ code: "", name: "", remark: "", entries: [emptyEntry()] });
    }
  };

  const handleOk = async () => {
    try {
      saveMutation.mutate(await form.validate());
    } catch {
      // 校验失败,表单内已显示错误信息。
    }
  };

  return (
    <Modal
      title={editing ? `编辑字典:${editing.name}` : "新建字典"}
      visible={visible}
      onOk={handleOk}
      confirmLoading={saveMutation.isPending}
      onCancel={onClose}
      unmountOnExit
      afterOpen={openWithDefault}
      style={{ width: 680 }}
    >
      <Form form={form} layout="vertical">
        <Form.Item field="code" label="编码" rules={[{ required: true, message: "请输入编码" }]}>
          <Input placeholder="如 common_status" maxLength={64} />
        </Form.Item>
        <Form.Item field="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
          <Input placeholder="显示名" maxLength={64} />
        </Form.Item>
        <Form.Item field="remark" label="备注">
          <Input placeholder="用途说明" maxLength={255} />
        </Form.Item>

        <Form.Item label="字典项" required>
          <Form.List field="entries">
            {(fields, { add, remove, move }) => (
              <>
                {/* 表头,列宽与下方表单行对齐(手柄 / 标签 / 值 / 启用 / 操作) */}
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: 8,
                    paddingLeft: 30,
                    color: "#86909c",
                    fontSize: 12
                  }}
                >
                  <span style={{ width: 120 }}>标签</span>
                  <span style={{ width: 100 }}>值</span>
                  <span style={{ width: 56 }}>启用</span>
                  <span>操作</span>
                </div>

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event: DragEndEvent) => {
                    const { active, over } = event;
                    if (over && active.id !== over.id) {
                      const oldIndex = fields.findIndex((f) => f.key === active.id);
                      const newIndex = fields.findIndex((f) => f.key === over.id);
                      if (oldIndex !== -1 && newIndex !== -1) {
                        move(oldIndex, newIndex);
                      }
                    }
                  }}
                >
                  <SortableContext
                    items={fields.map((f) => f.key)}
                    strategy={verticalListSortingStrategy}
                  >
                    {fields.map((field) => (
                      <SortableEntry
                        key={field.key}
                        id={field.key}
                        name={field.field}
                        onRemove={() => remove(fields.findIndex((f) => f.key === field.key))}
                      />
                    ))}
                  </SortableContext>
                </DndContext>

                <Button size="mini" onClick={() => add(emptyEntry())}>
                  + 添加字典项
                </Button>
              </>
            )}
          </Form.List>
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface SortableEntryProps {
  id: number;
  name: string;
  onRemove: () => void;
}

// 可拖拽的字典项行:手柄拖拽重排,顺序即提交时的排序(见 Form.List 的 move)。
function SortableEntry({ id, name, onRemove }: SortableEntryProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        display: "flex",
        gap: 8,
        marginBottom: 8,
        alignItems: "flex-start",
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1
      }}
    >
      <span
        {...attributes}
        {...listeners}
        style={{
          cursor: "grab",
          color: "#86909c",
          padding: "4px 6px",
          userSelect: "none",
          marginTop: 2
        }}
        title="拖拽排序"
      >
        ⋮⋮
      </span>
      <Form.Item field={`${name}.label`} rules={[{ required: true, message: "标签必填" }]} noStyle>
        <Input placeholder="标签,如 启用" style={{ width: 120 }} />
      </Form.Item>
      <Form.Item field={`${name}.value`} rules={[{ required: true, message: "值必填" }]} noStyle>
        <Input placeholder="值,如 1" style={{ width: 100 }} />
      </Form.Item>
      <Form.Item field={`${name}.enabled`} noStyle triggerPropName="checked">
        <Switch style={{ marginTop: 4 }} />
      </Form.Item>
      <Button size="mini" status="danger" onClick={onRemove} style={{ marginTop: 2 }}>
        删除
      </Button>
    </div>
  );
}

function emptyEntry(): EntryFormValue {
  return { label: "", value: "", enabled: true };
}
