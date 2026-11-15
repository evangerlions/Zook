/** Stable integration targets. Secrets belong to common PASSWORDS, never this module. */
export const FEISHU = {
  appId: "cli_aa22ab7005b81beb",
  recipient: "ou_5cb5bcc45117a8c1df0f934d3a20f705",
  base: "JWrZbEZJFa4hr8sSfuQck24Vnlb",
  expenses: "tblYzyeuvv9rFxcE",
  categories: "tblja2C93llw6yrL",
  secretKey: "feishu.app_secret",
  clientsKey: "feishu.integration_clients",
} as const;

export const FEISHU_FIELDS = {
  title: "消费条目", amount: "金额", category: "支出条目 - 大类",
  subcategory: "支出条目 - 小类", people: "人员", source: "支出来源", note: "备注",
  date: "创建日期",
} as const;

export type FeishuScope = "messages:send" | "bookkeeping:read" | "bookkeeping:create";
export interface FeishuClient { id: string; digest: string; scopes: FeishuScope[]; }
