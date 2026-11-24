import { loginPatch, openLogin, sealLogin, type AccountLogin } from "./account-login-secret.ts";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import type { KVManager } from "../../infrastructure/kv/kv-manager.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { strictObject } from "../../shared/strict-object.ts";
import { parseBailianAccessKeys } from "./bailian-token-plan-query.ts";
export const accountTypes = ["openrouter", "bai", "aliyun", "tencent", "volcengine", "token-plan", "agent-plan", "geyan"] as const;
export type AccountType = typeof accountTypes[number];
export interface BillingAccount { id: string; name: string; type: AccountType; providers: string[]; alerts: boolean; warning: number; critical: number; updatedAt: string; credentialKind?: "bailian-openapi"; }
export function queryMode(account: Pick<BillingAccount, "type" | "credentialKind">): "manual" | "automatic" {
  if (account.type === "agent-plan" || account.type === "geyan") return "manual";
  return account.type === "token-plan" && !account.credentialKind ? "manual" : "automatic";
}
interface StoredAccount extends BillingAccount { encryptedCredential?: string; encryptedLogin?: string; loginRevision?: string; }
const scope = "billing-accounts";
export class AccountStore {
  private readonly keys: Buffer[];
  constructor(private readonly kv: KVManager, secrets: string[], private readonly validateProviders: (providers: string[], type: AccountType) => Promise<void> = async () => {}) {
    this.keys = secrets.map(secret => Buffer.from(hkdfSync("sha256", secret, "zook", "billing-account-credentials-v1", 32)));
  }
  async list() {
    return (await this.records()).map(({ encryptedCredential, encryptedLogin, credentialKind, ...account }) => ({ ...account,
      credentialConfigured: Boolean(encryptedCredential), loginConfigured: Boolean(encryptedLogin),
      credentialSource: account.type === "bai" && account.providers.length ? "llm" as const : "account" as const,
      mode: queryMode({ type: account.type, credentialKind }) }));
  }
  async get(id: string) { const account = (await this.records()).find(a => a.id === id); if (!account) throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Billing account not found."); return account; }
  async credential(id: string): Promise<string | undefined> {
    const value = (await this.get(id)).encryptedCredential; if (!value) return;
    const [iv, tag, ciphertext] = value.split(".").map(s => Buffer.from(s, "base64"));
    for (const [index, key] of this.keys.entries()) { try { const cipher = createDecipheriv("aes-256-gcm", key, iv); cipher.setAuthTag(tag); const plain = Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString(); if (index > 0) {
      const original = await this.kv.getString(scope, "accounts");
      const accounts: StoredAccount[] = original ? JSON.parse(original) : [];
      const account = accounts.find(a => a.id === id);
      if (account?.encryptedCredential === value) {
        const nonce = randomBytes(12), wrapper = createCipheriv("aes-256-gcm", this.keys[0], nonce);
        const encrypted = Buffer.concat([wrapper.update(plain), wrapper.final()]);
        account.encryptedCredential = [nonce, wrapper.getAuthTag(), encrypted].map(v => v.toString("base64")).join(".");
        await this.kv.applyAtomic(scope, { compare: [{ key: "accounts", value: original ?? null }], set: [{ key: "accounts", value: JSON.stringify(accounts) }] });
      }
    } return plain; } catch {} }
    throw new Error("Billing credential decryption failed");
  }
  async save(input: unknown, expected?: StoredAccount) {
    const b = strictObject(input, ["id", "name", "type", "providers", "alerts", "warning", "critical", "credential", "login"]);
    if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 100 || !accountTypes.includes(b.type as AccountType) || typeof b.alerts !== "boolean" ||
      typeof b.warning !== "number" || !Number.isFinite(b.warning) || typeof b.critical !== "number" || !Number.isFinite(b.critical) || b.critical < 0 || b.warning <= b.critical ||
      !Array.isArray(b.providers) || b.providers.some(p => typeof p !== "string" || !/^[\w.:-]{1,100}$/.test(p)) ||
      (b.id !== undefined && (typeof b.id !== "string" || !/^[\w-]{1,100}$/.test(b.id))) ||
      (b.credential !== undefined && (typeof b.credential !== "string" || !b.credential || b.credential.length > 10000 || b.credential.includes("***")))) throw new ApplicationError(400, "REQ_INVALID_BODY", "Invalid billing account.");
    if (new Set(b.providers as string[]).size !== (b.providers as string[]).length) throw new ApplicationError(400, "REQ_INVALID_BODY", "Duplicate providers.");
    await this.validateProviders(b.providers as string[], b.type as AccountType);
    const original = await this.kv.getString(scope, "accounts");
    const records: StoredAccount[] = original ? JSON.parse(original) : [];
    const old = b.id ? await this.get(b.id as string) : undefined;
    if (old && old.type !== b.type) throw new ApplicationError(400, "REQ_INVALID_BODY", "Account type cannot be changed.");
    const type = b.type as AccountType;
    let credentialKind = old?.credentialKind;
    if (type === "token-plan" && typeof b.credential === "string") {
      if (!parseBailianAccessKeys(b.credential)) throw new ApplicationError(400, "REQ_INVALID_BODY", "Token Plan requires an Alibaba Cloud AccessKey ID and Secret.");
      credentialKind = "bailian-openapi";
    }
    const mode = queryMode({ type, credentialKind });
    if (mode === "manual" && b.alerts) throw new ApplicationError(400, "REQ_INVALID_BODY", "Manual accounts cannot enable automatic alerts.");
    if (credentialKind && (b.warning as number) > 100) throw new ApplicationError(400, "REQ_INVALID_BODY", "Token Plan thresholds must be between 0 and 100 percent.");
    if (expected && JSON.stringify(old) !== JSON.stringify(expected)) throw new ApplicationError(409, "REQ_INVALID_BODY", "Account changed; reload and retry.");
    const id = old?.id ?? randomUUID();
    const reusesLlm = b.type === "bai" && (b.providers as string[]).length > 0;
    if (reusesLlm && b.credential !== undefined) throw new ApplicationError(400, "REQ_INVALID_BODY", "Linked B.AI accounts reuse LLM credentials.");
    if (records.some(a => a.id !== id && a.providers.some(p => (b.providers as string[]).includes(p)))) throw new ApplicationError(400, "REQ_INVALID_BODY", "Provider already belongs to another account.");
    let encryptedLogin = old?.encryptedLogin;
    let loginRevision = old?.loginRevision;
    if (b.login !== undefined) {
      if (mode !== "manual") throw new ApplicationError(400, "REQ_INVALID_BODY", "Only browser-query accounts support saved logins.");
      const patch = loginPatch(b.login);
      const existing = encryptedLogin && !(patch.username && patch.password) ? openLogin(encryptedLogin, this.keys, id).login : undefined;
      const login = { ...existing, ...patch };
      if (!login.username || !login.password) throw new ApplicationError(400, "REQ_INVALID_BODY", "首次保存请填写账户名称和密码。");
      encryptedLogin = sealLogin(login as AccountLogin, this.keys[0], id);
      loginRevision = randomUUID();
    }
    let encryptedCredential = reusesLlm ? undefined : old?.encryptedCredential;
    if (b.credential !== undefined) {
      if (!this.keys.length) throw new ApplicationError(503, "REQ_INVALID_BODY", "Configure the same stable AUTH_ACCESS_TOKEN_SECRET for API and worker before saving billing credentials.");
      const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.keys[0], iv);
      const encrypted = Buffer.concat([cipher.update(b.credential as string), cipher.final()]);
      encryptedCredential = [iv, cipher.getAuthTag(), encrypted].map(v => v.toString("base64")).join(".");
    }
    const account: StoredAccount = { id, name: (b.name as string).trim(), type, providers: b.providers as string[], alerts: b.alerts as boolean,
      warning: b.warning as number, critical: b.critical as number, updatedAt: new Date().toISOString(), encryptedCredential, encryptedLogin, loginRevision, credentialKind };
    const saved = await this.kv.applyAtomic(scope, { compare: [{ key: "accounts", value: original ?? null }], set: [{ key: "accounts", value: JSON.stringify([...records.filter(a => a.id !== id), account]) }] });
    if (!saved) throw new ApplicationError(409, "REQ_INVALID_BODY", "Accounts changed; reload and retry.");
    return (await this.list()).find(a => a.id === id)!;
  }
  async saveLogin(id: string, patch: Partial<AccountLogin>) {
    const account = await this.get(id);
    const { name, type, providers, alerts, warning, critical } = account;
    return this.save({ id, name, type, providers, alerts, warning, critical, login: patch }, account);
  }
  async login(id: string): Promise<AccountLogin | undefined> {
    const original = await this.kv.getString(scope, "accounts");
    const accounts: StoredAccount[] = original ? JSON.parse(original) : [];
    const account = accounts.find(a => a.id === id);
    if (!account?.encryptedLogin) return;
    const { login, keyIndex } = openLogin(account.encryptedLogin, this.keys, id);
    if (keyIndex > 0) {
      account.encryptedLogin = sealLogin(login, this.keys[0], id);
      await this.kv.applyAtomic(scope, { compare: [{ key: "accounts", value: original ?? null }], set: [{ key: "accounts", value: JSON.stringify(accounts) }] });
    }
    return login;
  }
  private async records(): Promise<StoredAccount[]> { return await this.kv.getJson<StoredAccount[]>(scope, "accounts") ?? []; }
}
