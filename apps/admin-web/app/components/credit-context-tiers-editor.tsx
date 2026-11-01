import { Button, InputNumber, Table } from "antd";
import type { ContextTier } from "../lib/credit-pricing-editor";

interface Props {
  modelKey: string;
  tiers: ContextTier[];
  inputRate?: number;
  outputRate?: number;
  disabled: boolean;
  onChange: (tiers: ContextTier[]) => void;
}

export function CreditContextTiersEditor({ modelKey, tiers, inputRate, outputRate, disabled, onChange }: Props) {
  function update(index: number, field: keyof ContextTier, value: number | null) {
    if (value === null) return;
    onChange(tiers.map((tier, position) => position === index ? { ...tier, [field]: value } : tier));
  }
  return <div className="stack">
    <small className="field-hint">长上下文阶梯：输入 token 数严格超过阈值时使用该行倍率。缓存输入仍使用模型的缓存倍率；缓存倍率空白时使用当前阶梯的输入倍率。</small>
    <Table dataSource={tiers.map((tier, index) => ({ ...tier, index }))} rowKey="index" size="small" pagination={false}
      columns={[
        { title: "输入 token 阈值", key: "threshold", render: (_, tier) => <InputNumber
          aria-label={`${modelKey} 阶梯 ${tier.index + 1} 阈值`} min={0} precision={0} disabled={disabled}
          value={tier.abovePromptTokens} onChange={(value) => update(tier.index, "abovePromptTokens", value)} /> },
        ...(["inputPointsPerMillionTokens", "outputPointsPerMillionTokens"] as const).map((field) => ({
          title: field === "inputPointsPerMillionTokens" ? "未缓存输入倍率" : "输出倍率", key: field,
          render: (_: unknown, tier: ContextTier & { index: number }) => <InputNumber
            aria-label={`${modelKey} 阶梯 ${tier.index + 1} ${field}`} min={0} precision={1} step={0.1} disabled={disabled}
            value={tier[field] / 100} onChange={(value) => update(tier.index, field, value === null ? null : Math.round(value * 100))} />,
        })),
        { title: "操作", key: "delete", render: (_, tier) => <Button disabled={disabled} danger
          onClick={() => onChange(tiers.filter((_, index) => index !== tier.index))}>删除</Button> },
      ]} />
    <Button disabled={disabled || inputRate === undefined || outputRate === undefined}
      onClick={() => onChange([...tiers, { abovePromptTokens: (tiers.at(-1)?.abovePromptTokens ?? 0) + 32000,
        inputPointsPerMillionTokens: inputRate!, outputPointsPerMillionTokens: outputRate! }])}>添加阶梯</Button>
  </div>;
}
