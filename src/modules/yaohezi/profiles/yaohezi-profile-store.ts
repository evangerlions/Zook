/** Associations are routing metadata, never proof of patient identity or a health grant. */
export interface YaoheziAccountScope { appId: "yaohezi"; userId: string }
export interface YaoheziSelfBinding {
  appId: "yaohezi";
  subjectId: string;
  userId: string;
  bindingKind: "self_asserted";
  healthAccessEstablished: false;
  createdAt: string;
}
export interface CreateYaoheziSelfBinding {
  account: YaoheziAccountScope;
  /** Stable UUID from an explicitly selected local subject; never a name/phone/profile ID. */
  subjectId: string;
  operationId: string;
  confirmed: boolean;
}
export interface YaoheziProfileStore {
  /** Internal port only. Future public callers must also prove a trusted health device session. */
  createSelfBinding(command: CreateYaoheziSelfBinding): Promise<YaoheziSelfBinding>;
  listSelfBindings(account: YaoheziAccountScope): Promise<YaoheziSelfBinding[]>;
}
