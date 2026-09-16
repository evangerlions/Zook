import { Button, Input } from "antd";

import { Field } from "./field";
import type {
  GetuiGyAppCredentials,
  GetuiGySensitiveCredentialField,
} from "../lib/types";

interface GetuiGyCredentialFieldsProps {
  appId: string;
  credentials: GetuiGyAppCredentials;
  onChange: (field: "appId" | "appKey" | "appSecret" | "masterSecret", value: string) => void;
  onReveal: (field: GetuiGySensitiveCredentialField) => void;
  revealingCredential: string;
}

export function GetuiGyCredentialFields({
  appId,
  credentials,
  onChange,
  onReveal,
  revealingCredential,
}: GetuiGyCredentialFieldsProps) {
  return (
    <div className="mapping-value-grid">
      <Field label="GeYan AppID">
        <Input
          onChange={(event) => onChange("appId", event.target.value)}
          placeholder="输入 GeYan AppID"
          size="large"
          value={credentials.appId}
        />
      </Field>
      {(["appKey", "appSecret", "masterSecret"] as const).map((field) => (
        <Field key={field} label={field}>
          <div className="credential-input-row">
            <Input.Password
              autoComplete="off"
              onChange={(event) => onChange(field, event.target.value)}
              size="large"
              value={credentials[field]}
            />
            <Button
              disabled={!credentials[field]}
              loading={revealingCredential === `${appId}:base:${field}`}
              onClick={() => onReveal(field)}
            >
              显示
            </Button>
          </div>
        </Field>
      ))}
    </div>
  );
}
