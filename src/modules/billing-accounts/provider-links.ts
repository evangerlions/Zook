import type { AccountType } from "./account-store.ts";
export interface BillingProviderOption { key: string; label: string; accountType: AccountType; }
const accountTypes: Readonly<Record<string, AccountType>> = {
  openrouter: "openrouter", bai: "bai", bailian: "aliyun", bailian_token_plan: "token-plan",
  bailian_coding: "token-plan", volcengine: "volcengine", volcengine_agent_plan: "agent-plan",
};
/** Shared by validation and safe dropdown metadata. Never return provider credentials. */
export function billingProviderOptions(providers: readonly { key: string; type?: string; label?: string }[]): BillingProviderOption[] {
  return providers.flatMap(provider => {
    const providerType = provider.type ?? provider.key;
    const accountType = Object.hasOwn(accountTypes, providerType) ? accountTypes[providerType] : undefined;
    return accountType ? [{ key: provider.key, label: provider.label || provider.key, accountType }] : [];
  });
}
