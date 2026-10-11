import { Alert, Button, Input, Segmented, Select, Space, Spin } from "antd";
import { useEffect, useState } from "react";
import { useAdminSession } from "../lib/admin-session";
import { useBillingQuery } from "../lib/use-billing-query";
import { loadAiNovelUsage, type UsageQuery } from "../lib/ai-novel-usage-api";
import { UsageOverview } from "../components/ai-novel-usage/usage-overview";
import "../components/ai-novel-usage/usage.css";

export default function AiNovelUsageRoute() {
  const { selectedAppId, completeWorkspaceTransition } = useAdminSession();
  useEffect(() => {
    completeWorkspaceTransition();
  }, [completeWorkspaceTransition]);
  return selectedAppId === "ai_novel" ? (
    <UsagePage />
  ) : (
    <Alert type="info" message="请选择橘子写作项目空间查看付费与用量。" />
  );
}
function UsagePage() {
  const [query, setQuery] = useState<UsageQuery>({
    days: 30,
    tier: "all",
    environment: "production",
  });
  const result = useBillingQuery(
    () => loadAiNovelUsage(query),
    JSON.stringify(query),
  );
  return (
    <section className="stack usage-page">
      <header className="page-header">
        <div>
          <h1>付费与用量</h1>
          <p>观察支付、创作点消耗与每周额度是否合适。真实证据，不修改权益。</p>
        </div>
        <Button loading={result.loading} onClick={result.refresh}>
          刷新
        </Button>
      </header>
      <Space wrap>
        <Segmented
          aria-label="统计时间"
          value={query.days}
          options={[
            { label: "7 天", value: 7 },
            { label: "30 天", value: 30 },
            { label: "90 天", value: 90 },
          ]}
          onChange={(days) => setQuery((q) => ({ ...q, days: Number(days) }))}
        />
        <Select
          aria-label="消耗时档位"
          value={query.tier}
          onChange={(tier) => setQuery((q) => ({ ...q, tier }))}
          options={[
            { value: "all", label: "全部档位" },
            { value: "free", label: "Free" },
            { value: "plus", label: "Plus" },
            { value: "pro", label: "Pro" },
          ]}
        />
        <Select
          aria-label="支付环境"
          value={query.environment}
          onChange={(environment) => setQuery((q) => ({ ...q, environment }))}
          options={[
            { value: "production", label: "正式支付" },
            { value: "sandbox", label: "Sandbox 支付" },
          ]}
        />
        <Input.Search
          aria-label="精确查询用户"
          placeholder="精确用户 ID（查询全部证据）"
          allowClear
          onSearch={(userId) =>
            setQuery((q) => ({ ...q, userId: userId.trim() || undefined }))
          }
          style={{ width: 280 }}
        />
      </Space>
      {result.error ? (
        <Alert
          type="error"
          message={result.error}
          action={<Button onClick={result.refresh}>重试</Button>}
        />
      ) : null}
      {result.loading ? (
        <Spin tip="查询真实支付与消耗证据…">
          <div style={{ minHeight: 200 }} />
        </Spin>
      ) : result.data ? (
        <>
          <p className="usage-muted">
            UTC：{result.data.filter.from} — {result.data.filter.to}（右端不含）
          </p>
          <UsageOverview report={result.data} query={query} />
        </>
      ) : null}
    </section>
  );
}
