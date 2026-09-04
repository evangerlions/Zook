import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Flex, InputNumber, Select } from "antd";

import type {
  AiNovelChatModelOption,
  AiNovelModelSelectionConfig,
} from "../lib/types";

type WeightedModel = AiNovelModelSelectionConfig["chat"]["default"][number];

interface AiNovelModelWeightFieldsProps {
  disabled: boolean;
  items: WeightedModel[];
  models: AiNovelChatModelOption[];
  onChange(items: WeightedModel[]): void;
}

export function AiNovelModelWeightFields({
  disabled,
  items,
  models,
  onChange,
}: AiNovelModelWeightFieldsProps) {
  const selectedKeys = new Set(items.map((item) => item.modelKey));
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);

  function updateItem(index: number, patch: Partial<WeightedModel>) {
    onChange(items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item,
    ));
  }

  function addItem() {
    const modelKey = models.find((model) => !selectedKeys.has(model.key))?.key;
    if (modelKey) {
      onChange([...items, { modelKey, weight: 1 }]);
    }
  }

  return (
    <div className="stack">
      {items.map((item, index) => (
        <Flex align="end" gap={12} key={`${item.modelKey}-${index}`} wrap>
          <label className="field" style={{ flex: "1 1 320px" }}>
            <span className="field-label">模型 Key</span>
            <Select
              disabled={disabled}
              onChange={(modelKey) => updateItem(index, { modelKey })}
              optionFilterProp="label"
              options={models.map((model) => ({
                disabled: model.key !== item.modelKey && selectedKeys.has(model.key),
                label: `${model.label} · ${model.key}${model.configuredAvailable ? "" : "（当前路由不可用）"}`,
                value: model.key,
              }))}
              showSearch
              value={item.modelKey}
            />
          </label>
          <label className="field" style={{ flex: "0 0 150px" }}>
            <span className="field-label">Weight</span>
            <InputNumber
              addonAfter="%"
              disabled={disabled}
              max={100}
              min={0}
              onChange={(weight) => updateItem(index, { weight: weight ?? 0 })}
              precision={2}
              value={item.weight}
            />
          </label>
          <Button
            aria-label={`删除模型 ${item.modelKey}`}
            danger
            disabled={disabled || items.length === 1}
            icon={<DeleteOutlined />}
            onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
          />
        </Flex>
      ))}
      <Flex align="center" gap={12} justify="space-between" wrap>
        <Button
          disabled={disabled || selectedKeys.size >= models.length}
          icon={<PlusOutlined />}
          onClick={addItem}
        >
          添加模型
        </Button>
        <strong>总权重：{totalWeight}%</strong>
      </Flex>
      <small className={Math.abs(totalWeight - 100) > 0.001 ? "form-error" : "field-hint"}>
        所有模型权重之和必须等于 100；分桶复用 LLM 的 DID + UID routing affinity。
      </small>
    </div>
  );
}
