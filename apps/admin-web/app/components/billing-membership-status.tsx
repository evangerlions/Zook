import { CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled, MinusCircleOutlined, QuestionCircleOutlined, StopOutlined, UserDeleteOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import type { BillingMember } from "../lib/billing-admin-api";

export function membershipStatus(row: BillingMember) {
  if (row.accountDeletedAt) return { label: "账号已删除", Icon: UserDeleteOutlined, color: "#8c8c8c" };
  if (row.state === "expired") return { label: "已过期", Icon: CloseCircleFilled, color: "#8c8c8c" };
  if (row.state === "grace_period") return { label: "续费宽限期", Icon: ClockCircleOutlined, color: "#d48806" };
  if (row.state === "cancelled") return { label: row.active ? "已取消续订，会员仍有效" : "已取消续订，会员无效", Icon: StopOutlined, color: row.active ? "#d48806" : "#8c8c8c" };
  if (row.active) return { label: "会员有效", Icon: CheckCircleFilled, color: "#389e0d" };
  if (row.state === "free") return { label: "非会员", Icon: MinusCircleOutlined, color: "#8c8c8c" };
  return { label: "会员状态待确认", Icon: QuestionCircleOutlined, color: "#8c8c8c" };
}

export function BillingMembershipStatus({ member }: { member: BillingMember }) {
  return statusIcon(membershipStatus(member));
}

function statusIcon({ label, Icon, color }: ReturnType<typeof membershipStatus>) {
  return <Tooltip title={label}><span role="img" aria-label={label} tabIndex={0} style={{ color, fontSize: 20 }}><Icon aria-hidden /></span></Tooltip>;
}
