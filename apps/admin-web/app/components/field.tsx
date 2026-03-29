import { Flex, Switch, Typography } from "antd";
import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <Typography.Text className="field-label">{label}</Typography.Text>
      {children}
      {hint ? <Typography.Text className="field-hint" type="secondary">{hint}</Typography.Text> : null}
    </label>
  );
}

export function ToggleField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="toggle-field">
      <Flex className="toggle-field-copy" gap={6} vertical>
        <Typography.Text strong>{label}</Typography.Text>
        {hint ? <Typography.Text type="secondary">{hint}</Typography.Text> : null}
      </Flex>
      <Switch
        checked={checked}
        onChange={onChange}
      />
    </label>
  );
}
