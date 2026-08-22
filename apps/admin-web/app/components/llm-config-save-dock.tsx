import { CheckCircleFilled, SaveOutlined, WarningFilled } from "@ant-design/icons";
import { Button } from "antd";

export function LlmConfigSaveDock({
  disabled,
  loading,
  revision,
  validationError,
  onSave,
}: {
  disabled: boolean;
  loading: boolean;
  revision?: number;
  validationError: string;
  onSave: () => void;
}) {
  const hasValidationError = Boolean(validationError);

  return (
    <aside className={`llm-save-dock${hasValidationError ? " llm-save-dock--error" : ""}`}>
      <div aria-live="polite" className="llm-save-dock-status" role="status">
        <span className="llm-save-dock-icon" aria-hidden="true">
          {hasValidationError ? <WarningFilled /> : <CheckCircleFilled />}
        </span>
        <span className="llm-save-dock-copy">
          <strong>{hasValidationError ? "配置待修正" : "配置已通过校验"}</strong>
          <small>
            {hasValidationError
              ? "修正表单中的校验问题后即可保存"
              : revision
                ? `保存后将基于 R${revision} 生成新版本`
                : "保存后将创建首个配置版本"}
          </small>
        </span>
      </div>
      <Button
        disabled={disabled}
        icon={<SaveOutlined />}
        loading={loading}
        onClick={onSave}
        size="large"
        type="primary"
      >
        保存 LLM 配置
      </Button>
    </aside>
  );
}
