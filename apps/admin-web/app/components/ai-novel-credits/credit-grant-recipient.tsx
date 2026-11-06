import { MailOutlined, PhoneOutlined } from "@ant-design/icons";
import { Space, Tooltip } from "antd";
import type { CreditGrantRecord } from "../../lib/ai-novel-credit-admin-api";

export function CreditGrantRecipient({ record }: { record: CreditGrantRecord }) {
  const details = <Space direction="vertical" size={2}>
    {record.contactSource !== "snapshot" && <span>{record.contactSource === "current" ? "历史记录：当前联系方式" : "联系方式不可用"}</span>}
    <span><PhoneOutlined /> {record.phone ?? "—"}</span>
    <span><MailOutlined /> {record.email ?? "—"}</span>
  </Space>;
  return <Tooltip title={details}><span tabIndex={0} style={{ cursor: "help", borderBottom: "1px dotted" }}>{record.uid}</span></Tooltip>;
}
