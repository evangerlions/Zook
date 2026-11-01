import {
  Alert,
  Button,
  Card,
  Drawer,
  Input,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { useState } from "react";
import {
  loadAiNovelUsage,
  type UsageQuery,
  type UsageReport,
  type UsageUser,
} from "../../lib/ai-novel-usage-api";
import { useBillingQuery } from "../../lib/use-billing-query";
import { formatBillingMoney } from "../../lib/billing-format";

const number = (v: number) =>
  v.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
export function UsageUserSection({
  report,
  query,
}: {
  report: UsageReport;
  query: UsageQuery;
}) {
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState<"chargedPoints" | "absorbedPoints" | "denied">(
      "chargedPoints",
    );
  const [selected, setSelected] = useState<string>();
  const rows = report.users
    .filter((u) => u.userId.includes(search))
    .sort((a, b) => b[sort] - a[sort]);
  return (
    <Card title="用户观察">
      <Space wrap>
        <Input.Search
          aria-label="搜索用户ID"
          placeholder="在当前样本中搜索用户 ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Select
          aria-label="用户排序"
          value={sort}
          onChange={setSort}
          options={[
            { value: "chargedPoints", label: "按扣点" },
            { value: "absorbedPoints", label: "按平台承担" },
            { value: "denied", label: "按额度拦截" },
          ]}
        />
      </Space>
      <p className="usage-muted">
        区间扣点最高的最多 200
        位用户；按当前排序分页展示。余额为持久化快照，不触发权益刷新。
      </p>
      <UsageUsersTable rows={rows} onSelect={setSelected} />
      <Drawer
        title={selected}
        size={620}
        open={!!selected}
        onClose={() => setSelected(undefined)}
        destroyOnHidden
      >
        {selected ? (
          <UsageUserDetail
            key={`${selected}:${JSON.stringify(query)}`}
            userId={selected}
            query={query}
          />
        ) : null}
      </Drawer>
    </Card>
  );
}

function UsageUsersTable({
  rows,
  onSelect,
}: {
  rows: UsageUser[];
  onSelect: (id: string) => void;
}) {
  return (
    <Table<UsageUser>
      rowKey="userId"
      dataSource={rows}
      scroll={{ x: 1000 }}
      pagination={{ pageSize: 10 }}
      columns={[
        {
          title: "用户 / 当前快照档位",
          render: (_, u) => (
            <>
              <b>{u.userId}</b>
              <br />
              <Tag>{u.tier ?? "无余额记录"}</Tag>
            </>
          ),
        },
        {
          title: "确认支付（分币种）",
          render: (_, u) =>
            u.payments.map((p) => (
              <div key={p.currency}>
                {formatBillingMoney(p.grossMinor, p.currency)}
              </div>
            )),
        },
        {
          title: "实际扣点",
          render: (_, u) => number(u.chargedPoints),
          sorter: (a, b) => a.chargedPoints - b.chargedPoints,
        },
        {
          title: "周额度 / 活动点余额",
          render: (_, u) =>
            u.balance ? (
              <span
                title={`观察时间 ${u.balance.observedAt}；刷新边界 ${u.balance.refreshAt}`}
              >
                {number(u.balance.periodicPoints)} /{" "}
                {number(u.balance.giftPoints)}
              </span>
            ) : (
              "—"
            ),
        },
        { title: "平台承担", render: (_, u) => number(u.absorbedPoints) },
        { title: "拦截", dataIndex: "denied" },
        {
          title: "详情",
          render: (_, u) => (
            <Button type="link" onClick={() => onSelect(u.userId)}>
              查看
            </Button>
          ),
        },
      ]}
    />
  );
}
function UsageUserDetail({
  userId,
  query,
}: {
  userId: string;
  query: UsageQuery;
}) {
  const result = useBillingQuery(
    () => loadAiNovelUsage({ ...query, userId }),
    `${userId}:${JSON.stringify(query)}`,
  );
  if (result.error)
    return (
      <Alert
        type="error"
        message={result.error}
        action={<Button onClick={result.refresh}>重试</Button>}
      />
    );
  return (
    <div className="stack">
      <Card loading={result.loading} title="两池与平台承担">
        {result.data?.users.map((u) => (
          <div key={u.userId} className="usage-mini">
            <span>
              周额度扣点
              <br />
              <b>{number(u.periodicPoints)}</b>
            </span>
            <span>
              活动点扣点
              <br />
              <b>{number(u.giftPoints)}</b>
            </span>
            <span>
              平台承担
              <br />
              <b>{number(u.absorbedPoints)}</b>
            </span>
          </div>
        ))}
      </Card>
      <p className="usage-muted">
        最近最多 100
        条不可变事件，未采集历史不回填；不会展示小说原文。悬停点数可查看原始微点。
      </p>
      <UsageEventsTable events={result.data?.detailEvents} />
      <UsagePaymentsTable payments={result.data?.detailPayments} />
    </div>
  );
}

function UsageEventsTable({ events }: { events: UsageReport["detailEvents"] }) {
  return (
    <Table
      rowKey="id"
      size="small"
      pagination={{ pageSize: 8 }}
      dataSource={events}
      scroll={{ x: 600 }}
      columns={[
        {
          title: "时间 / 类型",
          render: (_, e) => (
            <>
              {e.at}
              <br />
              {
                (
                  {
                    debit: "扣点",
                    denied: "额度拦截",
                    grant: "赠送",
                  } as const
                )[e.kind]
              }
            </>
          ),
        },
        {
          title: "模型 / 调用",
          render: (_, e) => (
            <>
              {e.modelKey ?? "—"}
              <br />
              {e.callId ?? e.requestId}
            </>
          ),
        },
        {
          title: "周额度 / 活动 / 承担（点）",
          render: (_, e) => (
            <span
              title={`微点：${e.periodicMicros} / ${e.giftMicros} / ${e.absorbedMicros}`}
            >
              {[e.periodicMicros, e.giftMicros, e.absorbedMicros]
                .map((v) => number(Number(v) / 1_000_000))
                .join(" / ")}
            </span>
          ),
        },
      ]}
    />
  );
}

function UsagePaymentsTable({
  payments,
}: {
  payments: UsageReport["detailPayments"];
}) {
  return (
    <Table
      rowKey={(p) => `${p.at}:${p.kind}:${p.currency}:${p.amountMinor}`}
      size="small"
      dataSource={payments}
      pagination={{ pageSize: 8 }}
      columns={[
        {
          title: "支付时间 / 类型",
          render: (_, p) => (
            <>
              {p.at}
              <br />
              {p.kind}
            </>
          ),
        },
        {
          title: "金额",
          render: (_, p) => formatBillingMoney(p.amountMinor, p.currency),
        },
      ]}
    />
  );
}
