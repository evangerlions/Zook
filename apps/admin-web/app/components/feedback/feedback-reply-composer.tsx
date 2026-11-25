import { Alert, Button, Input, Select, Space, Upload, type UploadFile, type UploadProps } from "antd";
import { useRef, useState } from "react";

import { adminFeedbackApi } from "../../lib/admin-feedback-api";
import { FEEDBACK_REPLY_PRESETS, feedbackReplyImageLimitError } from "../../lib/feedback";
import { formatApiError } from "../../lib/format";
import type { AdminFeedbackReplyImage } from "../../lib/types";

const imageTypes = ["image/jpeg", "image/png", "image/webp"];

function isReplyImage(file: File) {
  return file.size > 0 && imageTypes.includes(file.type);
}

function encodeImage(file: File): Promise<AdminFeedbackReplyImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取图片，请重新选择。"));
    reader.onload = () => {
      const contentBase64 = String(reader.result).split(",", 2)[1];
      if (!contentBase64) {
        reject(new Error("图片为空，请重新选择。"));
        return;
      }
      resolve({ fileName: file.name, mimeType: file.type, contentBase64, sizeBytes: file.size });
    };
    reader.readAsDataURL(file);
  });
}

interface Props {
  feedbackId: string;
  closed: boolean;
  statusBusy: boolean;
  onSending: (sending: boolean) => void;
  onSent: (closed: boolean) => void;
}

export function FeedbackReplyComposer({ feedbackId, closed, statusBusy, onSending, onSent }: Props) {
  const [text, setText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<UploadFile[]>([]);
  const [sending, setSending] = useState<"send" | "close" | null>(null);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const submission = useRef<{ key: string; close: boolean } | null>(null);
  const disabled = sending !== null || statusBusy;
  const canSend = Boolean(text.trim() || selectedFiles.length);

  function changeText(value: string) {
    submission.current = null;
    setText(value);
  }

  const validateImage: UploadProps["beforeUpload"] = (file, batch) => {
    const limitError = feedbackReplyImageLimitError([...selectedFiles, ...batch.filter(isReplyImage)]);
    if (limitError) {
      if (batch[0] === file) setError(limitError);
      return Upload.LIST_IGNORE;
    }
    if (!isReplyImage(file)) {
      setError("请选择 JPEG、PNG 或 WebP 图片。");
      return Upload.LIST_IGNORE;
    }
    return false;
  };

  async function send(close: boolean) {
    if (!canSend || disabled || submitting.current) return;
    submitting.current = true;
    setError("");
    setSending(close ? "close" : "send");
    onSending(true);
    try {
      const files = selectedFiles.map((item) => {
        const file = item.originFileObj;
        if (!file) throw new Error("无法读取图片，请重新选择。");
        return file;
      });
      const limitError = feedbackReplyImageLimitError(files);
      if (limitError) throw new Error(limitError);
      const attachments = await Promise.all(files.map(encodeImage));
      if (!submission.current || submission.current.close !== close) {
        submission.current = { close, key: crypto.randomUUID() };
      }
      await adminFeedbackApi.replyToAiNovelFeedback(feedbackId, {
        ...(text.trim() ? { message: text.trim() } : {}),
        ...(attachments.length ? { attachments } : {}),
        submissionKey: submission.current.key,
        ...(close ? { close: true } : {}),
      });
      changeText("");
      setSelectedFiles([]);
      onSent(close);
    } catch (error) {
      setError(formatApiError(error));
    } finally {
      submitting.current = false;
      setSending(null);
      onSending(false);
    }
  }

  return (
    <section className="feedback-reply-composer" aria-label="回复反馈">
      {error ? <Alert type="error" title={error} closable={{ onClose: () => setError("") }} showIcon /> : null}
      <Select<string>
        aria-label="快捷回复"
        disabled={disabled}
        onChange={changeText}
        options={FEEDBACK_REPLY_PRESETS.map(({ label, message }) => ({ label, value: message }))}
        placeholder="快捷回复"
        value={undefined}
        style={{ width: 190 }}
      />
      <Input.TextArea
        aria-label="回复内容"
        autoSize={{ minRows: 3, maxRows: 7 }}
        disabled={disabled}
        onChange={(event) => changeText(event.target.value)}
        placeholder="输入回复"
        value={text}
      />
      <Upload
        accept={imageTypes.join(",")}
        beforeUpload={validateImage}
        disabled={disabled}
        fileList={selectedFiles}
        listType="picture"
        multiple
        onChange={({ fileList }) => {
          submission.current = null;
          setSelectedFiles(fileList);
        }}
      >
        <Button disabled={disabled}>添加图片</Button>
      </Upload>
      <Space wrap>
        <Button type="primary" disabled={!canSend || disabled} loading={sending === "send"} onClick={() => void send(false)}>
          发送回复
        </Button>
        {!closed ? (
          <Button disabled={!canSend || disabled} loading={sending === "close"} onClick={() => void send(true)}>
            回复并结单
          </Button>
        ) : null}
      </Space>
    </section>
  );
}
