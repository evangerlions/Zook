import type { NoticeState } from "./types";

export function formatTimestamp(value?: string): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatApiError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "发生了未知错误。";
}

export function makeNotice(tone: NoticeState["tone"], text: string): NoticeState {
  return { tone, text };
}
