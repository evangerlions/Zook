import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { AuthContext } from "../../../shared/types.ts";
import type { PasswordHasher } from "../password-hasher.ts";
import type { AppRegistryService } from "../../app-registry/app-registry.service.ts";
import type { AuthVerificationLimiter } from "../auth-verification-limiter.ts";
import type { StructuredLogger } from "../../../infrastructure/logging/pino-logger.module.ts";
import type { IdentityChangeCreateRequest, IdentityCodeRequest, IdentityCurrentProofRequest, IdentityTargetProof, IdentityChangeData } from "../../../generated/openapi/public-contracts.generated.ts";
import { ApplicationError, badRequest, conflict, forbidden } from "../../../shared/errors.ts";
import { randomId, sha256 } from "../../../shared/utils.ts";
import { AuthIdentityDirectory } from "./auth-identity-directory.ts";
import { maskIdentity, type IdentityChange, type IdentityKind, type IdentityVerificationOption } from "./auth-identity-models.ts";
import { normalizeAuthEmail, normalizeAuthPhone } from "./auth-identity-normalization.ts";
import { IdentityCodeService, type IdentityRequestContext } from "./identity-code-service.ts";

export class IdentityChangeService {
  private readonly directory: AuthIdentityDirectory;
  constructor(private readonly deps: {
    database: ApplicationDatabase; registry: AppRegistryService; hasher: PasswordHasher;
    limiter: AuthVerificationLimiter; codes: IdentityCodeService; logger: StructuredLogger;
  }) { this.directory = new AuthIdentityDirectory(deps.database); }
  private get store() { return this.deps.database.authIdentityStore; }

  async create(auth: AuthContext, input: IdentityChangeCreateRequest, now = new Date()): Promise<IdentityChangeData> {
    this.assertScope(auth, input.appId);
    return this.deps.database.withExclusiveSession(async () => {
      await this.deps.registry.ensureExistingMembership(auth.appId, auth.userId);
      const bindings = await this.directory.bindings(auth.appId, auth.userId);
      const mode = bindings.some(row => row.kind === input.kind) ? "replace" : "bind";
      if (mode !== input.expectedMode) conflict("AUTH_IDENTITY_STATE_CHANGED", "Sign-in methods changed. Please refresh and retry.");
      const change: IdentityChange = { id: randomId("identity_change"), appId: auth.appId, userId: auth.userId,
        kind: input.kind, mode, currentVerified: mode === "bind", revision: (await this.store.getAccount(auth.appId, auth.userId))!.revision,
        expiresAt: new Date(now.getTime() + 600_000).toISOString(), status: "pending" };
      if (mode === "replace" && !(await this.options(change)).length) forbidden("AUTH_VERIFICATION_REQUIRED", "No existing verification method is available.");
      await this.store.saveChange(change);
      this.log("created", change);
      return this.describe(change, now);
    });
  }

  async get(auth: AuthContext, id: string, now = new Date(), allowApplied = false): Promise<IdentityChange> {
    const change = await this.store.getChange(id);
    if (!change || change.appId !== auth.appId || change.userId !== auth.userId)
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Identity change is not available for this session.");
    await this.deps.registry.ensureExistingMembership(auth.appId, auth.userId);
    if (allowApplied && change.status === "applied") return change;
    if (new Date(change.expiresAt) <= now) throw new ApplicationError(410, "AUTH_IDENTITY_CHANGE_EXPIRED", "Identity change expired. Please start again.");
    const account = await this.store.getAccount(auth.appId, auth.userId);
    if (change.status !== "pending" || account?.revision !== change.revision)
      conflict("AUTH_IDENTITY_STATE_CHANGED", "Sign-in methods changed. Please refresh and retry.");
    return change;
  }

  async sendCode(auth: AuthContext, id: string, input: IdentityCodeRequest, context: IdentityRequestContext, now = new Date()) {
    this.assertScope(auth, input.appId);
    const { deliver, maskedDestination, challengeId } = await this.deps.database.withExclusiveSession(async () => {
      const change = await this.get(auth, id, now);
      const subject = await this.codeSubject(change, input);
      const challenge = { id: randomId("identity_code"), stage: input.stage, method: input.method, subject,
        codeKey: `identity:${change.appId}:${change.userId}:${change.id}:${input.stage}:${sha256(subject)}` };
      const deliver = await this.deps.codes.prepare(change, challenge, context, now);
      change.challenge = challenge;
      await this.store.saveChange(change);
      this.log("code_requested", change, { stage: input.stage, method: input.method });
      return { deliver, maskedDestination: maskIdentity(subject), challengeId: challenge.id };
    });
    const accepted = await deliver();
    return { ...accepted, maskedDestination, challengeId };
  }

  async verifyCurrent(auth: AuthContext, id: string, input: IdentityCurrentProofRequest, context: IdentityRequestContext, now = new Date()) {
    this.assertScope(auth, input.appId);
    return this.deps.database.withExclusiveSession(async () => {
      const change = await this.get(auth, id, now);
      if (change.mode !== "replace") badRequest("REQ_INVALID_BODY", "New bindings do not require current verification.");
      if (!(await this.options(change)).some(option => option.method === input.method))
        badRequest("REQ_INVALID_BODY", "This verification method is not available.");
      if (input.method === "password") {
        const rate = await this.deps.limiter.getRuntimeConfig();
        await this.deps.limiter.consumeEmailLoginLimits(auth.appId, `identity:${auth.userId}`, context.ipAddress, rate, now);
        const user = await this.deps.database.findUserById(auth.userId);
        if (!user || !this.deps.hasher.canVerify(user.passwordAlgo) || !this.deps.hasher.verify(input.password, user.passwordHash))
          badRequest("AUTH_CURRENT_PASSWORD_INVALID", "Current password is invalid.");
      } else {
        if (change.challenge?.stage !== "current" || change.challenge.method !== input.method) badRequest("AUTH_VERIFICATION_CODE_INVALID", "Verification code is invalid or expired.");
        await this.deps.codes.verify(change, input.challengeId, input.code, context, now);
        await this.deps.codes.consume(change, input.code);
      }
      change.currentVerified = true;
      delete change.challenge;
      await this.store.saveChange(change);
      this.log("current_verified", change, { method: input.method });
      return this.describe(change, now);
    });
  }

  /** Provider proof is verified before this short transaction, then owner/revision are rechecked. */
  async complete(auth: AuthContext, id: string, proof: IdentityTargetProof, context: IdentityRequestContext,
    providerTarget?: { kind: IdentityKind; subject: string; displayName?: string }, now = new Date()) {
    return this.deps.database.withExclusiveSession(async () => {
      const change = await this.get(auth, id, now, true);
      if (change.status === "applied") return { change, newlyApplied: false };
      if (!change.currentVerified) forbidden("AUTH_VERIFICATION_REQUIRED", "Verify an existing sign-in method first.");
      let subject: string;
      if (proof.type === "third_party") {
        if (!providerTarget || providerTarget.kind !== change.kind) badRequest("AUTH_PROVIDER_PROOF_INVALID", "Provider identity does not match this change.");
        subject = providerTarget.subject;
      } else {
        const challenge = change.challenge;
        if (!challenge || challenge.stage !== "target" || challenge.method !== proof.type)
          badRequest("AUTH_VERIFICATION_CODE_INVALID", "Verification code is invalid or expired.");
        await this.deps.codes.verify(change, proof.challengeId, proof.code, context, now);
        subject = challenge.subject;
      }
      await this.directory.bind(change.appId, change.userId, change.kind, subject, providerTarget?.displayName);
      change.status = "applied";
      await this.store.saveChange(change);
      await this.deps.codes.consume(change, proof.type === "third_party" ? undefined : proof.code);
      this.log("applied", change);
      return { change, newlyApplied: true };
    });
  }

  private async codeSubject(change: IdentityChange, input: IdentityCodeRequest): Promise<string> {
    const kind = input.method === "email_code" ? "email" : "phone";
    if (input.stage === "current") {
      const binding = (await this.directory.bindings(change.appId, change.userId)).find(row => row.kind === kind);
      if (!binding || change.mode !== "replace" || input.email || input.phone || input.phoneNa)
        badRequest("REQ_INVALID_BODY", "Current verification uses an existing bound destination.");
      return binding.subject;
    }
    if (!change.currentVerified) forbidden("AUTH_VERIFICATION_REQUIRED", "Verify an existing sign-in method first.");
    if (change.kind !== kind) badRequest("REQ_INVALID_BODY", "Target channel does not match this change.");
    if (kind === "email") {
      if (!input.email || input.phone || input.phoneNa) badRequest("REQ_INVALID_BODY", "Provide the target email only.");
      return normalizeAuthEmail(input.email);
    }
    if (!input.phone || input.email) badRequest("REQ_INVALID_BODY", "Provide the target phone only.");
    return normalizeAuthPhone(input.phone, input.phoneNa);
  }

  private async options(change: IdentityChange): Promise<IdentityVerificationOption[]> {
    const user = await this.deps.database.findUserById(change.userId);
    const bindings = await this.directory.bindings(change.appId, change.userId);
    const options: IdentityVerificationOption[] = user && this.deps.hasher.canVerify(user.passwordAlgo) ? [{ method: "password" }] : [];
    for (const binding of bindings) {
      if (binding.kind === "email" || binding.kind === "phone") options.push({
        method: binding.kind === "email" ? "email_code" : "sms_code", maskedDestination: maskIdentity(binding.subject) });
    }
    return options;
  }

  private async describe(change: IdentityChange, now: Date): Promise<IdentityChangeData> {
    const binding = (await this.directory.bindings(change.appId, change.userId)).find(row => row.kind === change.kind);
    return { changeId: change.id, kind: change.kind, mode: change.mode,
      nextStep: change.currentVerified ? "verify_target" : "verify_current",
      ...(binding ? { currentBinding: { kind: binding.kind, maskedValue: maskIdentity(binding.subject) } } : {}),
      verificationMethods: change.mode === "replace" ? await this.options(change) : [],
      accountSecurityRevision: change.revision, expiresInSeconds: Math.max(0, Math.ceil((new Date(change.expiresAt).getTime() - now.getTime()) / 1000)) };
  }

  private assertScope(auth: AuthContext, appId: string): void {
    if (auth.appId !== appId) forbidden("AUTH_APP_SCOPE_MISMATCH", "App scope does not match this session.");
    if (!this.directory.enabled(appId)) forbidden("APP_NOT_FOUND", "Identity changes are not enabled for this product.");
  }
  private log(event: string, change: IdentityChange, fields: Record<string, unknown> = {}): void {
    this.deps.logger.info(`auth.identity_change.${event}`, { appId: change.appId, userId: change.userId,
      kind: change.kind, mode: change.mode, ...fields });
  }
}
