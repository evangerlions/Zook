import type { AccountType } from "../account-store.ts";
export type ManualProvider = "token-plan" | "agent-plan" | "geyan";
export const providerPages: Record<ManualProvider, { url: string; hosts: string[]; labels: string[]; units: string[] }> = {
  "token-plan": { url: "https://bailian.console.aliyun.com/", hosts: ["aliyun.com", "aliyuncs.com", "alibaba.com", "alicdn.com", "mmstat.com", "alipay.com"], labels: ["剩余 Credits", "剩余Credits", "可用 Credits", "可用Credits", "剩余额度"], units: ["Credits"] },
  "agent-plan": { url: "https://console.volcengine.com/ark/", hosts: ["volcengine.com", "volces.com", "byteimg.com", "bytedance.com", "bytednsdoc.com", "bytescm.com", "bytedns.net", "bytegoofy.com"], labels: ["剩余 AFP", "剩余AFP", "可用 AFP", "可用AFP", "剩余额度"], units: ["AFP", "Credits"] },
  geyan: { url: "https://dev.getui.com/", hosts: ["getui.com", "geetest.com", "geevisit.com", "gtimg.com"], labels: [], units: [] },
};
export function manualProvider(type: AccountType): ManualProvider {
  if (!(type in providerPages)) throw new Error("This account does not use browser login");
  return type as ManualProvider;
}
export function allowedProviderUrl(provider: ManualProvider, raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
      providerPages[provider].hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

export function isBalancePage(provider: ManualProvider, raw: string): boolean {
  if (!allowedProviderUrl(provider, raw)) return false;
  const url = new URL(raw); const path = `${url.pathname}${url.hash}`.toLowerCase();
  switch (provider) {
    case "token-plan": return /(?:token|coding)[-_\/]?plan/.test(path);
    case "agent-plan": return /agent[-_\/]?plan/.test(path);
    case "geyan": return /(?:geyan|\/gy(?:[\/#?]|$)|one[-_]?click|finance|balance)/.test(path);
  }
}
