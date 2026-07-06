import { badRequest } from "../../../shared/errors.ts";

const MAX_FOCUS_MESSAGE_LENGTH = 280;

export function validateFocusMessagePayload(input: Record<string, unknown>) {
  const receiverUserId = String(input.receiver_user_id ?? input.receiverUserId ?? "").trim();
  if (!receiverUserId) {
    badRequest("REQ_INVALID_BODY", "receiver_user_id is required.");
  }
  const templateKey = input.template_key ?? input.templateKey;
  const customText = input.custom_text ?? input.customText;
  if (templateKey !== undefined && typeof templateKey !== "string") {
    badRequest("REQ_INVALID_BODY", "template_key must be a string.");
  }
  if (customText !== undefined && typeof customText !== "string") {
    badRequest("REQ_INVALID_BODY", "custom_text must be a string.");
  }
  if (typeof customText === "string" && customText.length > MAX_FOCUS_MESSAGE_LENGTH) {
    badRequest("REQ_INVALID_BODY", "custom_text is too long.");
  }
  if (!templateKey && !customText) {
    badRequest("REQ_INVALID_BODY", "template_key or custom_text is required.");
  }
}
