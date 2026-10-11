import { Card, Table } from "antd";
import type { UsageReport } from "../../lib/ai-novel-usage-api";
import { formatBillingMoney } from "../../lib/billing-format";

/** Low-frequency financial evidence, kept after the primary usage analysis. */
export function UsageRefunds({ report }: { report: UsageReport }) {
  const rows = report.money
    .filter((row) => row.refundMinor > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || a.currency.localeCompare(b.currency));
  return (
    <Card title="退款汇总">
      <p className="usage-muted">
        按退款发生日期（UTC）和币种汇总，沿用当前时间、档位、支付环境与用户筛选；不是逐笔退款明细。
      </p>
      <Table
        size="small"
        rowKey={(row) => `${row.date}:${row.currency}`}
        dataSource={rows}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{ emptyText: "筛选区间无有金额证据的退款" }}
        columns={[
          { title: "退款日期（UTC）", dataIndex: "date" },
          { title: "币种", dataIndex: "currency" },
          { title: "退款金额", align: "right", render: (_, row) => formatBillingMoney(row.refundMinor, row.currency) },
        ]}
      />
    </Card>
  );
}
