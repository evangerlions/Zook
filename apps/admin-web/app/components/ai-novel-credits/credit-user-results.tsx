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

export function CreditUserResults({ users, selected, disabled, onSelect }: Props) {
  return <Radio.Group aria-label="选择用户" className="credit-user-results" value={selected} disabled={disabled} onChange={event => onSelect(event.target.value)}>
    {users.map((user, index) => <div className={`credit-user-result${selected === user.uid ? " credit-user-result-selected" : ""}`} key={user.uid}>
      <span className="credit-user-result-number">{index + 1}</span>
      <Radio value={user.uid}>
      <span className="credit-user-result-fields">
        <span className="credit-user-result-field" title={user.uid}><Tag color="blue">UID</Tag>{user.uid}</span>
        <span className="credit-user-result-field" title={`手机号：${user.phone ?? "—"}`}><PhoneOutlined className="credit-user-result-phone" aria-label="手机号" />{user.phone ?? "—"}</span>
        <span className="credit-user-result-field" title={`邮箱：${user.email ?? "—"}`}><MailOutlined className="credit-user-result-email" aria-label="邮箱" />{user.email ?? "—"}</span>
      </span>
      </Radio>
    </div>)}
  </Radio.Group>;
}
