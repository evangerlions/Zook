/** One admin presentation vocabulary. Wire identities belong to their own concept;
 * distribution does not establish a precise market (Xiaomi/vivo/etc.). */
export const BILLING_TERMS = {
  market: { label: '渠道（Market）', options: [
    { value: 'app_store', label: 'App Store' }, { value: 'google_play', label: 'Google Play' },
    { value: 'xiaomi', label: '小米' }, { value: 'vivo', label: 'vivo' }, { value: 'oppo', label: 'OPPO' },
    { value: 'huawei', label: '华为' }, { value: 'honor', label: '荣耀' }, { value: 'direct', label: '官方直发' },
  ] },
  provider: { label: '支付服务商', options: [
    { value: 'revenuecat', label: 'RevenueCat' }, { value: 'alipay', label: '支付宝' },
  ] },
  source: { label: '支付来源', options: [
    { value: 'app_store', label: 'App Store' }, { value: 'play_store', label: 'Google Play' },
    { value: 'alipay', label: '支付宝' },
  ] },
  platform: { label: '运行平台', options: [
    { value: 'ios', label: 'iOS' }, { value: 'android', label: 'Android' },
    { value: 'macos', label: 'macOS' }, { value: 'web', label: 'Web' }, { value: 'windows', label: 'Windows' },
  ] },
  distribution: { label: '分发类型', options: [
    { value: 'app_store', label: 'App Store' }, { value: 'google_play', label: 'Google Play' },
    { value: 'china_android_store', label: '国内 Android 商店' }, { value: 'direct_android', label: 'Android 官方包' },
    { value: 'web', label: 'Web' }, { value: 'windows', label: 'Windows' },
  ] },
  environment: { label: '支付环境', options: [
    { value: 'PRODUCTION', label: '正式环境' }, { value: 'SANDBOX', label: '沙箱环境' },
  ] },
  tier: { label: '会员等级', options: [
    { value: 'plus', label: 'Plus' }, { value: 'pro', label: 'Pro' },
  ] },
} satisfies Record<string, {label: string; options: Array<{value: string; label: string}>}>;

export type BillingTerm = keyof typeof BILLING_TERMS;
export function billingTermValue(term: BillingTerm, value: string | null | undefined): string {
  if (!value) return term === 'market' ? '未知渠道' : '—';
  const key = term === 'environment' ? value.toUpperCase() : value;
  return BILLING_TERMS[term].options.find(option => option.value === key)?.label ?? `未知（${value}）`;
}
