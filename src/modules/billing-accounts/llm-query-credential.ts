import type { AccountStore, BillingAccount } from "./account-store.ts";
import type { CommonLlmConfigService } from "../../services/common-llm-config.service.ts";
import type { SecretReferenceResolver } from "../../services/secret-reference-resolver.ts";
export function llmQueryCredential(store: AccountStore, llm: CommonLlmConfigService, resolver: SecretReferenceResolver) {
  return async (account: BillingAccount) => {
    if (account.type !== "bai" || !account.providers.length) return store.credential(account.id);
    const providers = (await llm.getCurrentConfig()).providers;
    const provider = providers.find(p => p.key === account.providers[0] && (p.type ?? p.key) === "bai");
    return provider?.apiKey ? resolver.resolveString(provider.apiKey) : undefined;
  };
}
/** Remove the initial prototype copy; all subsequent updates remain owned by LLM configuration. */
export async function removeCopiedLlmCredentials(store: AccountStore) {
  for (const a of await store.list()) {
    const current = await store.get(a.id);
    if (current.type !== "bai" || !current.providers.length || !current.encryptedCredential) continue;
    const { id, name, type, providers, alerts, warning, critical } = current;
    await store.save({ id, name, type, providers, alerts, warning, critical }, current);
  }
}
