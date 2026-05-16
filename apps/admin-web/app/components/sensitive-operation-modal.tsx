import { Input, Modal } from "antd";
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
  description: _description,
  onClose,
  onAuthorized,
}: SensitiveOperationModalProps) {
  const [code, setCode] = useState("");
  const [errorText, setErrorText] = useState("");
  const [verifying, setVerifying] = useState(false);

  async function sendCode() {
    setErrorText("");
    try {
      await adminApi.requestSensitiveOperationCode(operation);
    } catch (error) {
      setErrorText(formatApiError(error));
    }
  }

  async function handleVerify() {
    setVerifying(true);
    setErrorText("");
    try {
      const grant = await adminApi.verifySensitiveOperationCode(operation, code.trim());
      await onAuthorized(grant);
      setCode("");
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
      setErrorText("");
      return;
    }

    void sendCode();
  }, [open, operation]);

  return (
    <Modal
      cancelText="取消"
      okButtonProps={{ loading: verifying, disabled: code.trim().length !== 6 }}
      okText="验证并继续"
      onCancel={onClose}
      onOk={() => void handleVerify()}
      open={open}
      title={title}
    >
      <div className="stack">
        <label className="field">
          <Input.OTP
            autoFocus
            formatter={(value) => value.replace(/\D/g, "")}
            length={6}
            onChange={(value) => setCode(value)}
            size="large"
            value={code}
          />
        </label>

        {errorText ? <p className="form-error">{errorText}</p> : null}
      </div>
    </Modal>
  );
}
