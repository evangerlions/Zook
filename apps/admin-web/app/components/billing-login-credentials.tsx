import { Button, Form, Input } from "antd";
export function BillingLoginCredentials({ busy, ready, configured = false, onLogin }: { busy: boolean; ready: boolean; configured?: boolean; onLogin(username: string, password: string): void }) {
  const [form] = Form.useForm<{ username: string; password: string }>();
  return <Form form={form} layout="vertical" style={{ maxWidth: 420 }} onFinish={({ username, password }) => {
    onLogin(username || "", password || ""); form.setFieldValue("password", "");
  }}>
    <Form.Item label="账户名称" name="username" rules={[{ required: !configured, whitespace: true, message: "请输入账户名称" }]}>
      <Input autoComplete="off" placeholder={configured ? "已保存，留空沿用或输入新账户" : "请输入账户名称"} maxLength={256} disabled={busy} />
    </Form.Item>
    <Form.Item label="密码" name="password" rules={[{ required: !configured, message: "请输入密码" }]}>
      <Input.Password autoComplete="new-password" placeholder={configured ? "已保存，留空沿用或输入新密码" : "请输入密码"} maxLength={1000} disabled={busy} />
    </Form.Item>
    <Button type="primary" htmlType="submit" loading={busy} disabled={!ready}>保存并登录</Button>
  </Form>;
}
