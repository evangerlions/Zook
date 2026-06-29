import type { TencentSesEmailEvent } from "./types";

export const MAIL_CALLBACK_EVENT_OPTIONS: Array<{ label: string; value: "" | TencentSesEmailEvent }> = [
  { label: "全部事件", value: "" },
  { label: "Delivered", value: "delivered" },
  { label: "Dropped", value: "dropped" },
  { label: "Bounce", value: "bounce" },
  { label: "Open", value: "open" },
  { label: "Click", value: "click" },
  { label: "Spam report", value: "spamreport" },
  { label: "Unsubscribe", value: "unsubscribe" },
  { label: "Deferred", value: "deferred" },
];

export function resolveMailCallbackEventColor(event: TencentSesEmailEvent) {
  switch (event) {
    case "delivered":
      return "success";
    case "open":
    case "click":
      return "blue";
    case "deferred":
      return "orange";
    case "dropped":
    case "bounce":
    case "spamreport":
    case "unsubscribe":
      return "error";
  }
}

export function formatMailCallbackCellValue(value?: string | number) {
  return value === undefined || value === "" ? "—" : String(value);
}
