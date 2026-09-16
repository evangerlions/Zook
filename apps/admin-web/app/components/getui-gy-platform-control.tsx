import { Button, Dropdown, Input } from "antd";

import { Field } from "./field";
import type {
  GetuiGyPlatformCredentials,
  GetuiGySensitiveCredentialField,
} from "../lib/types";

interface GetuiGyPlatformControlProps {
  appId: string;
  credentials?: GetuiGyPlatformCredentials;
  revealingCredential: string;
  onAdd: () => void;
  onChange: (field: "appId" | "appKey" | "appSecret" | "masterSecret", value: string) => void;
  onRemove: () => void;
  onReveal: (field: GetuiGySensitiveCredentialField) => void;
}

export function GetuiGyPlatformControl({
  appId,
  credentials,
  revealingCredential,
  onAdd,
  onChange,
  onRemove,
  onReveal,
}: GetuiGyPlatformControlProps) {
  if (!credentials) {
    return (
      <Dropdown
        menu={{
          items: [{ key: "ohos", label: "鸿蒙（OHOS）", onClick: onAdd }],
        }}
        trigger={["click"]}
      >
        <Button type="dashed">+</Button>
      </Dropdown>
    );
  }

  return (
    <div className="inline-panel">
      <div className="card-header">
        <div>
          <h4>鸿蒙平台凭据</h4>
          <p>这是该应用独立的 OHOS GeYan 凭据，不影响 Android / iOS 凭据。</p>
        </div>
        <Button danger onClick={onRemove}>删除平台</Button>
      </div>
      <div className="form-grid">
        <Field label="GeYan AppID">
          <Input onChange={(event) => onChange("appId", event.target.value)} value={credentials.appId} />
        </Field>
        {(["appKey", "appSecret", "masterSecret"] as const).map((field) => (
          <Field key={field} label={field}>
            <div className="credential-input-row">
              <Input.Password
                autoComplete="off"
                onChange={(event) => onChange(field, event.target.value)}
                value={credentials[field]}
              />
              <Button
                disabled={!credentials[field]}
                loading={revealingCredential === `${appId}:ohos:${field}`}
                onClick={() => onReveal(field)}
              >
                显示
              </Button>
            </div>
          </Field>
        ))}
      </div>
    </div>
  );
}
