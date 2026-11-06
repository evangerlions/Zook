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
    {users.map(user => <Radio className="credit-user-result" key={user.uid} value={user.uid}>
      <span className="credit-user-result-fields">
        <span className="credit-user-result-field" title={user.uid}><Tag color="blue">UID</Tag>{user.uid}</span>
        <span className="credit-user-result-field" title={user.phone ?? "—"}><Tag color="green">手机号</Tag>{user.phone ?? "—"}</span>
        <span className="credit-user-result-field" title={user.email ?? "—"}><Tag color="purple">邮箱</Tag>{user.email ?? "—"}</span>
      </span>
    </Radio>)}
  </Radio.Group>;
}
