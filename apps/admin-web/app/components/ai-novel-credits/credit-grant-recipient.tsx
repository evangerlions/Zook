import { MailOutlined, PhoneOutlined } from "@ant-design/icons";
import { Space, Tooltip } from "antd";
import type { CreditGrantRecord } from "../../lib/ai-novel-credit-admin-api";
import "./credit-grant-recipient.css";

export function CreditGrantRecipient({ record }: { record: CreditGrantRecord }) {
  const details = <Space orientation="vertical" size={2}>
    {record.contactSource !== "snapshot" && <span>{record.contactSource === "current" ? "历史记录：当前联系方式" : "联系方式不可用"}</span>}
    <span className="credit-grant-contact-row"><PhoneOutlined aria-label="手机号" /><span className="credit-grant-contact-value">{record.phone ?? "—"}</span></span>
    <span className="credit-grant-contact-row"><MailOutlined aria-label="邮箱" /><span className="credit-grant-contact-value">{record.email ?? "—"}</span></span>
  </Space>;
  return <Tooltip title={details} styles={{ root: { width: "max-content", maxWidth: "calc(100vw - 24px)" }, container: { overflowX: "auto" } }}><span tabIndex={0} style={{ cursor: "help", borderBottom: "1px dotted" }}>{record.uid}</span></Tooltip>;
}
