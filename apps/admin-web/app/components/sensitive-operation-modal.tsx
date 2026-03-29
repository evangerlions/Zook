import { Button, Input, Modal } from "antd";
import { useEffect, useState } from "react";

import { adminApi } from "../lib/admin-api";
import { formatApiError } from "../lib/format";
import type { AdminSensitiveOperationGrantDocument } from "../lib/types";

interface SensitiveOperationModalProps {
  open: boolean;
  operation: string;
  title: string;
  description: string;
  onClose: () => void;
  onAuthorized: (grant: AdminSensitiveOperationGrantDocument) => Promise<void> | void;
}

export function SensitiveOperationModal({
  open,
  operation,
  title,
  description,
  onClose,
  onAuthorized,
}: SensitiveOperationModalProps) {
  const [code, setCode] = useState("");
  const [recipientHint, setRecipientHint] = useState("");
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  async function sendCode() {
    setSending(true);
    setErrorText("");
    try {
      const result = await adminApi.requestSensitiveOperationCode(operation);
      setRecipientHint(result.recipientEmailMasked);
      setStatusText(
        `验证码已发送至 ${result.recipientEmailMasked}，${Math.max(1, Math.floor(result.expiresInSeconds / 60))} 分钟内有效。`,
      );
    } catch (error) {
      setErrorText(formatApiError(error));
    } finally {
      setSending(false);
    }
  }

  async function handleVerify() {
    setVerifying(true);
    setErrorText("");
    try {
      const grant = await adminApi.verifySensitiveOperationCode(operation, code.trim());
      await onAuthorized(grant);
      setCode("");
      setStatusText("");
      setErrorText("");
      onClose();
    } catch (error) {
      setErrorText(formatApiError(error));
    } finally {
      setVerifying(false);
    }
  }

  useEffect(() => {
    if (!open) {
      setCode("");
      setRecipientHint("");
      setStatusText("");
      setErrorText("");
      return;
    }

    void sendCode();
  }, [open, operation]);

  return (
    <Modal
      cancelText="取消"
      okButtonProps={{ loading: verifying }}
      okText="验证并继续"
      onCancel={onClose}
      onOk={() => void handleVerify()}
      open={open}
      title={title}
    >
      <div className="stack">
        <p>{description}</p>
        <label className="field">
          <span className="field-label">邮箱验证码</span>
          <Input
            maxLength={6}
            onChange={(event) => setCode(event.target.value)}
            placeholder="请输入 6 位验证码"
            size="large"
            value={code}
          />
          <small className="field-hint">
            {recipientHint ? `验证码会发送到 ${recipientHint}` : "验证码会发送到预设的管理邮箱。"}
          </small>
        </label>

        <div className="button-row">
          <Button loading={sending} onClick={() => void sendCode()}>
            {sending ? "发送中..." : "重新发送验证码"}
          </Button>
          {statusText ? <small className="field-hint">{statusText}</small> : null}
        </div>

        {errorText ? <p className="form-error">{errorText}</p> : null}
      </div>
    </Modal>
  );
}
