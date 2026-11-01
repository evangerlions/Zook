import { Card, Empty, Select, Slider, Statistic, Button, Space } from "antd";
import { useState } from "react";
import { LlmChart } from "../llm-monitor/llm-chart";
import type { UsageReport } from "../../lib/ai-novel-usage-api";
import { replayResult } from "../../lib/ai-novel-usage-charts";

export function UsageReplay({ report }: { report: UsageReport }) {
  const [tier, setTier] = useState("plus"),
    [percent, setPercent] = useState(100);
  const sample = report.simulation.find((r) => r.tier === tier)!;
  const quota = (sample.limitPoints * percent) / 100,
    result = replayResult(sample.consumption, quota, sample.limitPoints);
  const budgets = Array.from(
    { length: 16 },
    (_, i) => sample.limitPoints * (0.25 + i * 0.125),
  );
  return (
    <Card title="每周额度调整模拟" className="usage-replay">
      <p className="usage-muted">
        看看每周给多少点，能覆盖更多已发生的消耗。每个样本是一个完整的用户周周期，包含周额度和活动点消耗。仅模拟，不修改真实额度；未发生的需求不计入。
      </p>
      <Space wrap>
        <Select
          aria-label="模拟档位"
          value={tier}
          onChange={setTier}
          options={report.simulation.map((t) => ({
            value: t.tier,
            label: t.tier.toUpperCase(),
          }))}
        />
        <Button onClick={() => setPercent(100)}>重置模拟</Button>
      </Space>
      <div className="usage-grid">
        <div>
          <Statistic title="模拟周额度 / 点" value={quota} />
          <Slider
            aria-label="模拟周额度百分比"
            min={25}
            max={200}
            step={5}
            value={percent}
            onChange={setPercent}
            marks={{ 25: "25%", 100: "当前", 200: "200%" }}
          />
          <div className="usage-mini">
            <Statistic
              title="消耗低于模拟额度的周期占比"
              value={result.percent ?? "—"}
              precision={1}
              suffix={result.percent === null ? undefined : "%"}
            />
            <Statistic
              title="达到或超过模拟额度的周期"
              value={`${result.hits} / ${result.total}`}
            />
            <Statistic title="比当前额度多 / 少触顶的周期数" value={result.change} />
          </div>
        </div>
        <div>
          {result.total ? (
            <LlmChart
              height={240}
              summary="横轴：模拟每周点数；纵轴：消耗低于该额度的完整周周期占比"
              option={{
                tooltip: { trigger: "axis", valueFormatter: (value: unknown) => `${value}%` },
                grid: { left: 55, right: 25, bottom: 35 },
                xAxis: {
                  type: "category",
                  data: budgets.map((v) => Math.round(v)),
                  name: "点 / 周",
                },
                yAxis: { type: "value", min: 0, max: 100, name: "%" },
                series: [
                  {
                    name: "消耗低于模拟额度的周期占比",
                    type: "line",
                    data: budgets.map(
                      (b) =>
                        replayResult(sample.consumption, b, sample.limitPoints)
                          .percent,
                    ),
                  },
                ],
              }}
            />
          ) : (
            <Empty description="暂无完整周周期可模拟" />
          )}
        </div>
      </div>
    </Card>
  );
}
