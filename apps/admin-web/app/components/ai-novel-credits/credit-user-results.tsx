import { MailOutlined, PhoneOutlined } from "@ant-design/icons";
import { Radio, Tag } from "antd";
import type { CreditUserCandidate } from "../../lib/ai-novel-credit-admin-api";
import "./credit-user-results.css";

interface Props {
  users: CreditUserCandidate[];
  selected?: string;
  disabled: boolean;
  onSelect: (uid: string) => void;
}

function CreditUserIdentity({ user }: { user: CreditUserCandidate }) {
  return <>
    <span className="credit-user-result-field" title={user.uid}><Tag color="blue">UID</Tag>{user.uid}</span>
    <span className="credit-user-result-field" title={`手机号：${user.phone ?? "—"}`}><PhoneOutlined className="credit-user-result-phone" aria-label="手机号" />{user.phone ?? "—"}</span>
    <span className="credit-user-result-field" title={`邮箱：${user.email ?? "—"}`}><MailOutlined className="credit-user-result-email" aria-label="邮箱" />{user.email ?? "—"}</span>
  </>;
}

export function CreditSelectedUser({ user }: { user?: CreditUserCandidate }) {
  if (!user) return null;
  return <span className="credit-selected-user" aria-label="已选择用户">
    <span className="credit-selected-user-label">已选择</span>
    <CreditUserIdentity user={user} />
  </span>;
}

export function CreditUserResults({ users, selected, disabled, onSelect }: Props) {
  return <Radio.Group aria-label="选择用户" className="credit-user-results" value={selected} disabled={disabled} onChange={event => onSelect(event.target.value)}>
    {users.map((user, index) => <div className={`credit-user-result${selected === user.uid ? " credit-user-result-selected" : ""}`} key={user.uid}>
      <span className="credit-user-result-number">{index + 1}</span>
      <Radio value={user.uid}>
      <span className="credit-user-result-fields">
        <CreditUserIdentity user={user} />
      </span>
      </Radio>
    </div>)}
  </Radio.Group>;
}
