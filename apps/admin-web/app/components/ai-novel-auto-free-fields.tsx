import { DatePicker, Space, Switch, Typography } from "antd";
import dayjs from "dayjs";
import type { AiNovelAutoFreeConfig } from "../../../../src/shared/ai-novel-auto-free.ts";

export function AiNovelAutoFreeFields({ value, disabled, onChange }: {
  value?: AiNovelAutoFreeConfig;
  disabled: boolean;
  onChange: (value: AiNovelAutoFreeConfig) => void;
}) {
  const config = value ?? { enabled: false };
  return <section aria-label="Auto 限时免费" className="stack">
    <Typography.Title level={4}>Auto 限时免费</Typography.Title>
    <Space wrap>
      <Switch aria-label="启用 Auto 限时免费" checked={config.enabled} disabled={disabled}
        checkedChildren="开启" unCheckedChildren="关闭"
        onChange={enabled => onChange({ ...config, enabled })} />
      <DatePicker aria-label="免费开始时间" placeholder="开始时间（可不填）" showTime disabled={disabled}
        value={config.startsAt ? dayjs(config.startsAt) : null}
        onChange={date => onChange({ ...config, startsAt: date?.toISOString() })} />
      <DatePicker aria-label="免费结束时间" placeholder="结束时间（可不填）" showTime disabled={disabled}
        value={config.endsAt ? dayjs(config.endsAt) : null}
        onChange={date => onChange({ ...config, endsAt: date?.toISOString() })} />
    </Space>
    <Typography.Text type="secondary">
      开启后，生效期内 Auto 聊天不扣 credits，客户端显示“限时免费”；旧版未指定模型也按 Auto 处理。
      手动模型和 embedding 仍正常计费。时间按浏览器本地时区选择；留空表示不限制，可随时手动关闭。
      修改后请点击“保存模型选择”。已开始的请求沿用开始时的计费规则。
    </Typography.Text>
  </section>;
}
