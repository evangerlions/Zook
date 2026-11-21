import type { AuthIdentityStore } from "../modules/auth/identity/auth-identity-store.ts";
import type { AppIdentityAccount, AppIdentityBinding, IdentityChange, IdentityKind } from "../modules/auth/identity/auth-identity-models.ts";

export class InMemoryAuthIdentityStore implements AuthIdentityStore {
  private readonly accounts = new Map<string, AppIdentityAccount>();
  private readonly bindings = new Map<string, AppIdentityBinding>();
  private readonly changes = new Map<string, IdentityChange>();

  async getAccount(app: string, user: string) { return this.clone(this.accounts.get(`${app}:${user}`)); }
  async saveAccount(account: AppIdentityAccount) { this.accounts.set(`${account.appId}:${account.userId}`, structuredClone(account)); }
  async findBinding(app: string, kind: IdentityKind, subject: string) { return this.clone(this.bindings.get(`${app}:${kind}:${subject}`)); }
  async listBindings(app: string, user: string) {
    return structuredClone([...this.bindings.values()].filter(row => row.appId === app && row.userId === user && row.status === "bound"));
  }
  async saveBinding(binding: AppIdentityBinding) {
    const duplicate = [...this.bindings.values()].find(row => row.appId === binding.appId && row.kind === binding.kind
      && row.userId === binding.userId && row.status === "bound" && binding.status === "bound" && row.subject !== binding.subject);
    if (duplicate) throw new Error("Duplicate active app identity kind");
    this.bindings.set(`${binding.appId}:${binding.kind}:${binding.subject}`, structuredClone(binding));
  }
  async getChange(id: string) { return this.clone(this.changes.get(id)); }
  async saveChange(change: IdentityChange) { this.changes.set(change.id, structuredClone(change)); }
  async deleteChanges(appId: string, userId: string) {
    for (const [id, change] of this.changes) if (change.appId === appId && change.userId === userId) this.changes.delete(id);
  }
  async deleteApp(appId: string) {
    for (const [key, account] of this.accounts) if (account.appId === appId) this.accounts.delete(key);
    for (const [key, binding] of this.bindings) if (binding.appId === appId) this.bindings.delete(key);
    for (const [key, change] of this.changes) if (change.appId === appId) this.changes.delete(key);
  }
  private clone<T>(value: T | undefined): T | undefined { return value === undefined ? undefined : structuredClone(value); }
}
