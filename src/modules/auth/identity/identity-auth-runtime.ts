import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { KVManager } from "../../../infrastructure/kv/kv-manager.ts";
import type { StructuredLogger } from "../../../infrastructure/logging/pino-logger.module.ts";
import type { RegistrationEmailSender } from "../../../services/tencent-ses-registration-email.service.ts";
import type { SmsVerificationSender } from "../../../services/tencent-sms-verification.service.ts";
import type { SmsVerificationRecordService } from "../../../services/sms-verification-record.service.ts";
import type { CommonAuthRateLimitConfigService } from "../../../services/common-auth-rate-limit-config.service.ts";
import type { CommonPasswordConfigService } from "../../../services/common-password-config.service.ts";
import type { RequestEmailContextService } from "../../../services/request-email-context.service.ts";
import type { HttpRequest } from "../../../shared/types.ts";
import type { AuthContext } from "../../../shared/types.ts";
import type { IdentityCompleteRequest } from "../../../generated/openapi/public-contracts.generated.ts";
import type { AppRegistryService } from "../../app-registry/app-registry.service.ts";
import type { AuthService } from "../auth.service.ts";
import type { PasswordHasher } from "../password-hasher.ts";
import { randomNumericCode } from "../../../shared/utils.ts";
import { forbidden } from "../../../shared/errors.ts";
import { AuthVerificationLimiter } from "../auth-verification-limiter.ts";
import { IdentityChangeService } from "./identity-change.service.ts";
import { IdentityCodeService, type IdentityRequestContext } from "./identity-code-service.ts";
import { AuthIdentityDirectory } from "./auth-identity-directory.ts";
import { ThirdPartyAuthService, type ThirdPartyRequestContext } from "../third-party/third-party-auth.service.ts";
import { GoogleIdentityVerifier } from "../third-party/google-identity-verifier.ts";
import { AppleIdentityVerifier } from "../third-party/apple-identity-verifier.ts";
import { WechatIdentityVerifier } from "../third-party/wechat-identity-verifier.ts";
import { AiNovelAuthClientSource } from "../../ai-novel/ai-novel-auth-clients.ts";
import type { ThirdPartyClientSource, ThirdPartyIdentityVerifier } from "../third-party/third-party-models.ts";
import type { ThirdPartyProvider } from "./auth-identity-models.ts";

export interface IdentityAuthOverrides {
  clients?: ThirdPartyClientSource;
  fetcher?: typeof fetch;
  /** Deterministic provider boundary for tests; production always verifies provider proofs. */
  verifiers?: Record<ThirdPartyProvider, ThirdPartyIdentityVerifier>;
}

export function createIdentityAuthRuntime(deps: {
  database: ApplicationDatabase; kv: KVManager; registry: AppRegistryService; hasher: PasswordHasher;
  emailContext: RequestEmailContextService;
  auth: AuthService; logger: StructuredLogger; rateLimits: CommonAuthRateLimitConfigService;
  passwords: CommonPasswordConfigService; emailSender: RegistrationEmailSender;
  smsSender: SmsVerificationSender; smsRecords: SmsVerificationRecordService; codeGenerator?: () => string;
  overrides?: IdentityAuthOverrides;
}) {
  const limiter = new AuthVerificationLimiter(deps.kv, deps.rateLimits);
  const codes = new IdentityCodeService({ database: deps.database, registry: deps.registry, limiter,
    emailSender: deps.emailSender, smsSender: deps.smsSender, smsRecords: deps.smsRecords,
    codeGenerator: deps.codeGenerator ?? (() => randomNumericCode(6)) });
  const changes = new IdentityChangeService({ ...deps, limiter, codes });
  const clients = deps.overrides?.clients ?? new AiNovelAuthClientSource(deps.passwords);
  const fetcher = deps.overrides?.fetcher ?? fetch;
  const verifiers = deps.overrides?.verifiers ?? { google: new GoogleIdentityVerifier(clients, fetcher),
    apple: new AppleIdentityVerifier(clients, fetcher), wechat: new WechatIdentityVerifier(clients, fetcher) };
  const thirdParty = new ThirdPartyAuthService({ ...deps, changes, clients, verifiers });
  const directory = new AuthIdentityDirectory(deps.database);

  return { changes, thirdParty, directory,
    deliveryContext: (request: HttpRequest) => deps.emailContext.resolve(request),
    async complete(auth: AuthContext, id: string, input: IdentityCompleteRequest,
      context: IdentityRequestContext, providerContext?: ThirdPartyRequestContext) {
      if (input.appId !== auth.appId) forbidden("AUTH_APP_SCOPE_MISMATCH", "App scope does not match this session.");
      const change = await changes.get(auth, id, new Date(), true);
      const target = change.status !== "applied" && input.proof.type === "third_party"
        ? (await thirdParty.verify(input.appId, input.proof.authorizationId, input.proof.credential,
          providerContext!, "identity_change", auth, id)).identity : undefined;
      const applied = await changes.complete(auth, id, input.proof, context, target);
      if (applied.newlyApplied && applied.change.mode === "replace") await deps.auth.revokeAllSessions(auth.appId, auth.userId);
      const session = await deps.auth.issueSession(auth.userId, auth.appId);
      return { changeId: id, status: "applied" as const, session };
    },
  };
}

export type IdentityAuthRuntime = ReturnType<typeof createIdentityAuthRuntime>;
