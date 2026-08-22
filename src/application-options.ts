import { ApplicationDatabase } from "./infrastructure/database/application-database.ts";
import type { JobQueue } from "./infrastructure/queue/job-queue.ts";
import type { KVBackend, KVManager } from "./infrastructure/kv/kv-manager.ts";
import type { ClientLogEncryptionKeyResolver } from "./services/client-log-upload.service.ts";
import type { EmbeddingProvider } from "./services/embedding-manager.ts";
import type { GeoResolver } from "./services/request-email-context.service.ts";
import type { LLMProvider } from "./services/llm-manager.ts";
import type { CaptchaVerificationService, TencentCaptchaVerificationConfig } from "./services/tencent-captcha-verification.service.ts";
import type { RegistrationEmailSender } from "./services/tencent-ses-registration-email.service.ts";
import type { SmsVerificationSender, TencentSmsVerificationConfig } from "./services/tencent-sms-verification.service.ts";
import type { TelemetryGatewayConfig } from "./modules/telemetry/telemetry-gateway-types.ts";
import type { DatabaseSeed } from "./shared/types.ts";

export interface CreateApplicationOptions {
  seed?: DatabaseSeed;
  serviceName?: string;
  emitLogs?: boolean;
  registrationCodeGenerator?: () => string;
  registrationEmailSender?: RegistrationEmailSender;
  smsVerificationSender?: SmsVerificationSender;
  captchaVerificationService?: CaptchaVerificationService;
  tencentSmsVerificationConfig?: TencentSmsVerificationConfig;
  tencentCaptchaVerificationConfig?: TencentCaptchaVerificationConfig;
  llmProviders?: Record<string, LLMProvider>;
  embeddingProviders?: Record<string, EmbeddingProvider>;
  kvBackend?: KVBackend;
  kvManager?: KVManager;
  geoResolver?: GeoResolver;
  logEncryptionKeys?: Record<string, string>;
  logEncryptionKeyResolver?: ClientLogEncryptionKeyResolver;
  adminBasicAuth?: {
    username: string;
    password: string;
  };
  adminSensitiveOperation?: {
    secondaryPassword?: string;
  };
  secureRefreshCookie?: boolean;
  refreshCookieSameSite?: "Lax" | "None" | "Strict";
  /**
   * Dev/debug-only SMS provider bypass for public `test=true` requests.
   * Production App Review accounts must use CommonTestAccountService instead.
   */
  publicSmsTestBypassEnabled?: boolean;
  accessTokenSecret?: string;
  accessTokenPreviousSecrets?: string[];
  databaseUrl?: string;
  migrationDatabaseUrl?: string;
  /**
   * Test-only escape hatch for injecting a database double.
   * Production runtime should rely on PostgreSQL-backed storage.
   */
  database?: ApplicationDatabase;
  /**
   * Test-only factory for constructing a database double from the resolved seed.
   */
  databaseFactory?: (
    seed: DatabaseSeed,
  ) => Promise<ApplicationDatabase> | ApplicationDatabase;
  queueBackend?: "memory" | "redis";
  queue?: JobQueue;
  queueRedisUrl?: string;
  fileStorageRoot?: string;
  aiNovelAuditFileRoot?: string;
  telemetryGatewayConfig?: TelemetryGatewayConfig;
  telemetryFetchImplementation?: typeof fetch;
  /**
   * FrogSleep is not a launched product by default. Keep it behind an explicit
   * switch so existing apps and admin surfaces stay unchanged in production.
   */
  frogsleepEnabled?: boolean;
}
