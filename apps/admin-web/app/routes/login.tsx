import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useState } from "react";
import { Navigate } from "react-router";

import { useAdminSession } from "../lib/admin-session";

export default function LoginRoute() {
  const { adminUser, authenticating, login, runtimeConfig } = useAdminSession();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (adminUser) {
    return <Navigate replace to="/apps" />;
  }

  async function handleSubmit() {
    if (!username.trim() || !password) {
      setError("请输入用户名和密码。");
      return;
    }

    setError("");

    try {
      await login(username.trim(), password);
    } catch {
      setError("用户名或密码错误。");
    }
  }

  return (
    <main className="login-shell">
      <div className="login-panel">
        <section className="login-brand">
          <strong className="login-brand-mark">{runtimeConfig.brandName.replace(/\s+Control Room$/, "") || "Zook"}</strong>
        </section>

        <section className="login-card">
          <Card bordered={false} className="login-form-card">
            <div className="login-header">
              <Typography.Title level={2}>管理员登录</Typography.Title>
            </div>

            <Form className="stack" layout="vertical" onFinish={() => void handleSubmit()}>
              <Form.Item label="用户名">
                <Input
                  autoComplete="username"
                  disabled={authenticating}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="admin"
                  size="large"
                  value={username}
                />
              </Form.Item>

              <Form.Item label="密码">
                <Input.Password
                  autoComplete="current-password"
                  disabled={authenticating}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="输入密码"
                  size="large"
                  value={password}
                />
              </Form.Item>

              {error ? <Alert message={error} showIcon type="error" /> : null}

              <Button block htmlType="submit" loading={authenticating} size="large" type="primary">
                进入后台
              </Button>
            </Form>
          </Card>
        </section>
      </div>
    </main>
  );
}
