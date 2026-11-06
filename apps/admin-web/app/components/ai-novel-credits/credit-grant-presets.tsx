import { Button, Space } from "antd";

const presetPoints = [10, 50, 100, 500, 1000];

export function CreditGrantPresets({ points, disabled, onSelect }: {
  points: number | null;
  disabled: boolean;
  onSelect: (points: number) => void;
}) {
  return <Space wrap aria-label="常用点数">
    {presetPoints.map(value => <Button key={value} type={points === value ? "primary" : "default"} ghost={points === value} disabled={disabled} onClick={() => onSelect(value)}>{value}</Button>)}
  </Space>;
}
