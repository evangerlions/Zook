import type { AppIdentityAccount, AppIdentityBinding, IdentityChange, IdentityKind } from "./auth-identity-models.ts";

/** All writes participate in the caller's ApplicationDatabase transaction. */
export interface AuthIdentityStore {
  getAccount(appId: string, userId: string): Promise<AppIdentityAccount | undefined>;
  saveAccount(account: AppIdentityAccount): Promise<void>;
  findBinding(appId: string, kind: IdentityKind, subject: string): Promise<AppIdentityBinding | undefined>;
  listBindings(appId: string, userId: string): Promise<AppIdentityBinding[]>;
  saveBinding(binding: AppIdentityBinding): Promise<void>;
  getChange(id: string): Promise<IdentityChange | undefined>;
  saveChange(change: IdentityChange): Promise<void>;
  deleteChanges(appId: string, userId: string): Promise<void>;
  deleteApp(appId: string): Promise<void>;
}
