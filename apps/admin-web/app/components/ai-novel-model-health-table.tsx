import { Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import { formatMetricNumber, formatPercent } from "./llm-monitor/llm-monitor-view-model";
import type { AiNovelModelHealth } from "../lib/types";
import { aiNovelModelHealthColor } from "../lib/ai-novel-model-health";
import { AI_NOVEL_MODEL_HEALTH_COLUMN_TITLES } from "../lib/ai-novel-model-health-table";

interface AiNovelModelHealthTableProps {
  items: AiNovelModelHealth[];
}

export function AiNovelModelHealthTable({ items }: AiNovelModelHealthTableProps) {
  return (
    <section className="ai-novel-model-health">
      <div className="ai-novel-model-health__heading">
        <div>
          <h3>模型运行状态</h3>
          <p>实际命中率为过去 24 小时的调用占比；健康调整权重会按总权重归一化。</p>
        </div>
      </div>
      <Table<AiNovelModelHealth>
        columns={healthColumns()}
        dataSource={items}
        locale={{ emptyText: "暂无模型运行数据" }}
        pagination={false}
        rowKey="modelKey"
        scroll={{ x: 860 }}
        size="small"
      />
    </section>
  );
}

function healthColumns(): ColumnsType<AiNovelModelHealth> {
  return [
    {
      title: AI_NOVEL_MODEL_HEALTH_COLUMN_TITLES[0],
      dataIndex: "modelKey",
      ellipsis: true,
      fixed: "left",
      width: 220,
    },
    {
      title: AI_NOVEL_MODEL_HEALTH_COLUMN_TITLES[1],
      dataIndex: "configuredWeight",
      width: 100,
      render: (value) => formatPercent(value),
    },
    {
      title: AI_NOVEL_MODEL_HEALTH_COLUMN_TITLES[2],
      dataIndex: "effectiveWeight",
      width: 100,
      render: (value) => formatPercent(value),
    },
    {
      title: AI_NOVEL_MODEL_HEALTH_COLUMN_TITLES[3],
      dataIndex: "actualHitRate",
      width: 120,
      render: (value) => formatPercent(value),
    },
    {
      title: AI_NOVEL_MODEL_HEALTH_COLUMN_TITLES[4],
      dataIndex: "successRate",
      width: 100,
      render: (value) => value === undefined ? "—" : formatPercent(value),
    },
    {
      title: AI_NOVEL_MODEL_HEALTH_COLUMN_TITLES[5],
      dataIndex: "healthScore",
      width: 100,
      render: (value) => <Tag color={aiNovelModelHealthColor(value)}>{formatPercent(value)}</Tag>,
    },
    {
      title: AI_NOVEL_MODEL_HEALTH_COLUMN_TITLES[6],
      dataIndex: "sampleSize",
      width: 90,
      render: (value) => formatMetricNumber(value),
    },
    {
      title: AI_NOVEL_MODEL_HEALTH_COLUMN_TITLES[7],
      dataIndex: "available",
      width: 100,
      render: (value) => (
        <Tag color={value ? "success" : "error"}>{value ? "可用" : "不可用"}</Tag>
      ),
    },
  ];
}
