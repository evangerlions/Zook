import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { UserRecord } from "../../../shared/types.ts";
import { conflict, forbidden } from "../../../shared/errors.ts";
import { createOpaqueToken, randomId } from "../../../shared/utils.ts";
import type { AppRegistryService } from "../../app-registry/app-registry.service.ts";
import type { PasswordHasher } from "../password-hasher.ts";
import { maskIdentity, type AccountSecuritySummary, type AppIdentityAccount, type AppIdentityBinding, type IdentityKind } from "./auth-identity-models.ts";

/** The only app-scoped identity lookup/write path. Other products keep legacy lookup. */
export class AuthIdentityDirectory {
  constructor(private readonly database: ApplicationDatabase) {}
  private get store() { return this.database.authIdentityStore; }
  enabled(appId: string): boolean { return appId === "ai_novel"; }

  async initialize(appId: string, user: UserRecord): Promise<AppIdentityAccount> {
    return this.database.withExclusiveSession(async () => {
      const existing = await this.store.getAccount(appId, user.id);
      if (existing) return existing;
      const account = { appId, userId: user.id, revision: 1, phonePromptOffered: false };
      for (const kind of ["email", "phone"] as const) {
        const subject = user[kind]?.trim();
        if (!subject) continue;
        const value = kind === "email" ? subject.toLowerCase() : subject;
        const binding = await this.store.findBinding(appId, kind, value);
        if (!binding) await this.store.saveBinding({ appId, userId: user.id, kind, subject: value, status: "bound" });
      }
      await this.store.saveAccount(account);
      return account;
    });
  }

  async find(appId: string, kind: IdentityKind, subject: string): Promise<UserRecord | undefined> {
    if (!this.enabled(appId)) return this.globalUser(kind, subject);
    let binding = await this.store.findBinding(appId, kind, subject);
    if (binding) return binding.status === "bound" ? this.database.findUserById(binding.userId) : undefined;
    const global = await this.globalUser(kind, subject);
    if (!global) return undefined;
    const membership = await this.database.findAppUser(appId, global.id);
    if (!membership) return global;
    if (await this.store.getAccount(appId, global.id)) return undefined;
    await this.initialize(appId, global);
    binding = await this.store.findBinding(appId, kind, subject);
    return binding?.status === "bound" ? this.database.findUserById(binding.userId) : undefined;
  }

  async resolveVerified(input: {
    appId: string; kind: IdentityKind; subject: string; registry: AppRegistryService;
    hasher: PasswordHasher; now: Date; password?: string; userId?: string;
  }): Promise<{ user: UserRecord; autoCreatedUser: boolean }> {
    return this.database.withExclusiveSession(async () => {
      let user = await this.find(input.appId, input.kind, input.subject);
      const autoCreatedUser = !user;
      if (!user) {
        const app = await input.registry.getAppOrThrow(input.appId);
        if (app.joinMode !== "AUTO") forbidden("APP_JOIN_INVITE_REQUIRED", "This app requires an invite to join.");
        const global = await this.globalUser(input.kind, input.subject);
        const contact = !global && (input.kind === "email" || input.kind === "phone") ? { [input.kind]: input.subject } : {};
        user = { id: input.userId ?? randomId("user"), ...contact,
          passwordHash: input.hasher.hash(input.password ?? createOpaqueToken("pwd")),
          passwordAlgo: input.password ? input.hasher.algorithm : input.kind === "email" ? "email-code-only" : "sms-code-only",
          status: "ACTIVE", createdAt: input.now.toISOString() };
        await this.database.insertUser(user);
      }
      if (user.status === "BLOCKED") forbidden("AUTH_USER_BLOCKED", "The user is blocked across all apps.");
      await input.registry.ensureMembership(input.appId, user.id, input.now);
      if (this.enabled(input.appId)) {
        await this.initialize(input.appId, user);
        await this.bind(input.appId, user.id, input.kind, input.subject);
      }
      return { user, autoCreatedUser };
    });
  }

  async bind(appId: string, userId: string, kind: IdentityKind, subject: string, displayName?: string): Promise<void> {
    await this.database.withExclusiveSession(async () => {
      const user = await this.database.findUserById(userId);
      if (!user) forbidden("APP_MEMBER_DELETED", "The product account is unavailable.");
      const membership = await this.database.findAppUser(appId, userId);
      if (membership?.status !== "ACTIVE") forbidden("APP_MEMBER_DELETED", "The product account is unavailable.");
      const account = await this.initialize(appId, user);
      // Initializing the legacy target membership is required before conflict checks.
      await this.find(appId, kind, subject);
      const target = await this.store.findBinding(appId, kind, subject);
      if (target?.status === "bound" && target.userId === userId) return;
      if (target?.status === "bound") {
        const source = await this.database.findAppUser(appId, target.userId);
        if (source?.status !== "DELETED") conflict("AUTH_IDENTITY_ALREADY_BOUND", "This sign-in method belongs to another active account.");
        const sourceUser = await this.database.findUserById(target.userId);
        if (sourceUser?.status === "BLOCKED") forbidden("AUTH_USER_BLOCKED", "The user is blocked across all apps.");
        const sourceAccount = await this.store.getAccount(appId, target.userId);
        if (sourceAccount) await this.store.saveAccount({ ...sourceAccount, revision: sourceAccount.revision + 1 });
      }
      const current = (await this.store.listBindings(appId, userId)).find(row => row.kind === kind);
      if (current) await this.store.saveBinding({ ...current, status: "released" });
      await this.store.saveBinding({ appId, userId, kind, subject, status: "bound", ...(displayName ? { displayName } : {}) });
      await this.store.saveAccount({ ...account, revision: account.revision + 1 });
    });
  }

  async security(appId: string, user: UserRecord): Promise<AccountSecuritySummary> {
    const account = await this.initialize(appId, user);
    const rows = await this.store.listBindings(appId, user.id);
    return { revision: account.revision, bindings: rows.map(row => ({ kind: row.kind,
      ...((row.kind === "email" || row.kind === "phone") ? { maskedValue: maskIdentity(row.subject) } : {}),
      ...(row.displayName ? { displayName: row.displayName } : {}) })) };
  }

  async bindings(appId: string, userId: string): Promise<AppIdentityBinding[]> {
    const user = await this.database.findUserById(userId);
    if (user) await this.initialize(appId, user);
    return this.store.listBindings(appId, userId);
  }

  async offerPhonePrompt(appId: string, userId: string, provider: IdentityKind, region: string): Promise<"bind_phone" | "none"> {
    if (region !== "CN" || (provider !== "wechat" && provider !== "apple")) return "none";
    return this.database.withExclusiveSession(async () => {
      const account = await this.store.getAccount(appId, userId);
      if (!account || account.phonePromptOffered || (await this.store.listBindings(appId, userId)).some(row => row.kind === "phone")) return "none";
      await this.store.saveAccount({ ...account, phonePromptOffered: true });
      return "bind_phone";
    });
  }

  private async globalUser(kind: IdentityKind, subject: string): Promise<UserRecord | undefined> {
    switch (kind) {
      case "email": return this.database.findUserByAccount(subject);
      case "phone": return this.database.findUserByPhone(subject);
      case "wechat": case "google": case "apple": return undefined;
    }
  }
}
