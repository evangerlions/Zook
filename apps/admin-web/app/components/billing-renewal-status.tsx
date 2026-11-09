import { Tooltip } from "antd";

const descriptions: Record<string, string> = {
  will_renew: "当前设置为自动续订。",
  will_not_renew: "已关闭续订，当前权益持续至到期。",
  will_change_product: "下期将切换套餐。",
  will_pause: "当前周期结束后将暂停订阅。",
  requires_price_increase_consent: "需同意涨价，否则到期后不会续订。",
  has_already_renewed: "下一周期已扣款；之后是否续订需另行确认。",
};

export function BillingRenewalStatus({ value }: { value?: string | null }) {
  if (!value) return <>—</>;
  const description = Object.hasOwn(descriptions, value)
    ? descriptions[value]
    : "未识别的 RevenueCat 续订状态。";
  return <Tooltip title={description}>
    <span tabIndex={0} aria-label={`${value}：${description}`}>{value}</span>
  </Tooltip>;
}
