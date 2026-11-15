import { Form, Input, InputNumber, Modal, Select, Switch } from "antd";
import { useEffect } from "react";
import { types, manualTypes, type Account, type AccountType, type BillingProviderOption } from "../lib/billing-accounts";
export function BillingAccountEditor({ account, accounts, providerOptions, open, saving, onCancel, onSave }: { account?: Account; accounts: Account[]; providerOptions: BillingProviderOption[]; open: boolean; saving: boolean; onCancel(): void; onSave(value: unknown): void }) {
  const [form] = Form.useForm(); const type = Form.useWatch("type", form) as AccountType;
  const manual = manualTypes.includes(type);
  const linkedProviders = Form.useWatch("providers", form);
  const reuseLlm = type === "bai" && Boolean(linkedProviders?.length);
  useEffect(() => { form.resetFields(); form.setFieldsValue(account ? { ...account, providers: [...account.providers] } : { type: "openrouter", warning: 20, critical: 5, alerts: true, providers: [] }); }, [account, open, form]);
  return <Modal title={account ? "编辑计费账号" : "新增计费账号"} open={open} confirmLoading={saving} onCancel={onCancel} onOk={() => void form.validateFields().then(v => onSave({
    ...(account ? { id: account.id } : {}), name: v.name, type: v.type, providers: v.providers ?? [],
    warning: manual ? 1 : v.warning, critical: manual ? 0 : v.critical, alerts: manual ? false : Boolean(v.alerts), ...(!reuseLlm && v.credential ? { credential: v.credential } : {}), ...(manual && (v.loginUsername?.trim() || v.loginPassword) ? { login: { ...(v.loginUsername?.trim() ? { username: v.loginUsername.trim() } : {}), ...(v.loginPassword ? { password: v.loginPassword } : {}) } } : {}) }))}>
    <Form form={form} layout="vertical">
      <Form.Item name="name" label="账号名称" rules={[{ required: true }]}><Input maxLength={100} /></Form.Item>
      <Form.Item name="type" label="服务商" rules={[{ required: true }]}><Select onChange={v => { form.setFieldsValue({ providers: [], alerts: v === "openrouter", warning: v === "openrouter" ? 20 : undefined, critical: v === "openrouter" ? 5 : undefined }); }} disabled={Boolean(account)} options={Object.entries(types).map(([value, label]) => ({ value, label }))} /></Form.Item>
      <Form.Item name="providers" label="关联 LLM Provider"><Select mode="multiple" showSearch allowClear virtual={false} optionFilterProp="label" placeholder="选择 Provider" options={providerOptions.filter(p => p.accountType === type).map(p => {
        const owner = accounts.find(a => a.id !== account?.id && a.providers.includes(p.key));
        return { value: p.key, label: `${p.label === p.key ? p.key : `${p.label}（${p.key}）`}${owner ? ` · 已关联 ${owner.name}` : ""}`, disabled: Boolean(owner) };
      })} /></Form.Item>
      {manual && <><Form.Item name="loginUsername" label="登录账户名称"><Input autoComplete="off" placeholder={account?.loginConfigured ? "已保存；留空保留" : "请输入账户名称"} /></Form.Item><Form.Item name="loginPassword" label="登录密码"><Input.Password autoComplete="new-password" placeholder={account?.loginConfigured ? "已保存；留空保留" : "请输入密码"} /></Form.Item></>}
      {reuseLlm && <Form.Item label="查询密钥">复用关联 LLM Provider 的密钥</Form.Item>}
      {!manual && !reuseLlm && <Form.Item name="credential" label={type === "openrouter" ? "Management Key" : type === "bai" ? "API Key" : '查询凭证 JSON：{"accessKey":"…","secretKey":"…"}'} extra={account?.credentialConfigured ? "已配置；留空保留现值" : undefined}><Input.Password autoComplete="new-password" /></Form.Item>}
      {!manual && <><Form.Item name="alerts" label="自动预警" valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="warning" label={`预警阈值（${type === "openrouter" ? "USD" : type === "bai" ? "Credits" : "账号币种"}）`} rules={[{ required: true }]}><InputNumber min={0} /></Form.Item>
      <Form.Item name="critical" label={`紧急阈值（${type === "openrouter" ? "USD" : type === "bai" ? "Credits" : "账号币种"}）`} rules={[{ required: true }]}><InputNumber min={0} /></Form.Item></>}
    </Form>
  </Modal>;
}
