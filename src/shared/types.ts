export type AppStatus = "ACTIVE" | "BLOCKED";
export type JoinMode = "AUTO" | "INVITE_ONLY";
export type UserStatus = "ACTIVE" | "BLOCKED";
export type AppUserStatus = "ACTIVE" | "BLOCKED";
export type RoleStatus = "ACTIVE" | "BLOCKED";
export type PermissionStatus = "ACTIVE" | "BLOCKED";
export type FileStatus = "PENDING" | "CONFIRMED" | "EXPIRED";
export type NotificationStatus =
  | "PENDING"
  | "QUEUED"
  | "SENT"
  | "FAILED"
  | "ENQUEUE_FAILED";
export type ClientType = "web" | "app";
export type EventName = "page_view" | "page_leave" | "page_heartbeat";
export type Platform = "web" | "ios" | "android";
export type TencentSesRegion = "ap-guangzhou" | "ap-hongkong";
export type LlmRoutingStrategy = "auto" | "fixed";
export type LlmModelKind = "chat" | "embedding";
export type LlmMetricsRange = "24h" | "7d" | "30d";
export type LlmSmokeTestStatus = "success" | "failed" | "skipped";
export type ErrorCode =
  | "AI_EMBEDDING_INPUT_INVALID"
  | "AI_TASK_TYPE_NOT_SUPPORTED"
  | "AI_UPSTREAM_BAD_GATEWAY"
  | "AI_UPSTREAM_TIMEOUT"
  | "ADMIN_AUTH_REQUIRED"
  | "ADMIN_BASIC_AUTH_REQUIRED"
  | "ADMIN_INVALID_CREDENTIAL"
  | "ADMIN_CONFIG_INVALID_JSON"
  | "ADMIN_APP_ALREADY_EXISTS"
  | "ADMIN_APP_ID_RESERVED"
  | "ADMIN_APP_DELETE_REQUIRES_EMPTY_CONFIG"
  | "ADMIN_EMAIL_SERVICE_INVALID"
  | "ADMIN_I18N_INVALID"
  | "ADMIN_LLM_SERVICE_INVALID"
  | "ADMIN_PASSWORD_INVALID"
  | "ADMIN_RATE_LIMITED"
  | "ADMIN_SENSITIVE_OPERATION_REQUIRED"
  | "ADMIN_SENSITIVE_CODE_REQUIRED"
  | "ADMIN_SENSITIVE_CODE_INVALID"
  | "ADMIN_SENSITIVE_RATE_LIMITED"
  | "AUTH_INVALID_CREDENTIAL"
  | "AUTH_BEARER_REQUIRED"
  | "AUTH_INVALID_TOKEN"
  | "AUTH_REFRESH_TOKEN_REQUIRED"
  | "AUTH_REFRESH_TOKEN_REVOKED"
  | "AUTH_VERIFICATION_CODE_REQUIRED"
  | "AUTH_VERIFICATION_CODE_INVALID"
  | "AUTH_ACCOUNT_ALREADY_EXISTS"
  | "AUTH_RATE_LIMITED"
  | "AUTH_QR_LOGIN_TOKEN_REQUIRED"
  | "AUTH_QR_LOGIN_INVALID"
  | "AUTH_QR_LOGIN_EXPIRED"
  | "AUTH_QR_LOGIN_ALREADY_USED"
  | "AUTH_APP_SCOPE_MISMATCH"
  | "AUTH_LOGIN_TEMPORARILY_LOCKED"
  | "AUTH_USER_BLOCKED"
  | "APP_NOT_FOUND"
  | "APP_BLOCKED"
  | "APP_JOIN_INVITE_REQUIRED"
  | "APP_MEMBER_BLOCKED"
  | "IAM_PERMISSION_DENIED"
  | "FILE_ACCESS_DENIED"
  | "EMAIL_SERVICE_NOT_CONFIGURED"
  | "EMAIL_PROVIDER_REQUEST_FAILED"
  | "LLM_MODEL_NOT_FOUND"
  | "LLM_SERVICE_NOT_CONFIGURED"
  | "LLM_ROUTE_NOT_AVAILABLE"
  | "LLM_PROVIDER_REQUEST_FAILED"
  | "LLM_PROVIDER_RESPONSE_INVALID"
  | "LOG_UNSUPPORTED_ENCRYPTION"
  | "LOG_DECRYPT_FAILED"
  | "LOG_DECOMPRESS_FAILED"
  | "LOG_INVALID_NDJSON"
  | "LOG_TASK_MISMATCH"
  | "LOG_PAYLOAD_TOO_LARGE"
  | "REQ_INVALID_BODY"
  | "REQ_INVALID_HEADER"
  | "REQ_INVALID_QUERY"
  | "REQ_INVALID_EVENT"
  | "REQ_DATE_RANGE_INVALID"
  | "SYS_INTERNAL_ERROR";

export interface AppRecord {
  id: string;
  code: string;
  name: string;
  nameI18n: AppNameI18n;
  status: AppStatus;
  apiDomain?: string;
  joinMode: JoinMode;
  createdAt: string;
}

export interface AppNameI18n {
  "zh-CN": string;
  "en-US": string;
  [locale: string]: string;
}

export interface UserRecord {
  id: string;
  email?: string;
  phone?: string;
  passwordHash: string;
  passwordAlgo: string;
  status: UserStatus;
  createdAt: string;
}

export interface AppUserRecord {
  id: string;
  appId: string;
  userId: string;
  status: AppUserStatus;
  joinedAt: string;
}

export interface RoleRecord {
  id: string;
  appId: string;
  code: string;
  name: string;
  status: RoleStatus;
}

export interface PermissionRecord {
  id: string;
  code: string;
  name: string;
  status: PermissionStatus;
}

export interface RolePermissionRecord {
  id: string;
  roleId: string;
  permissionId: string;
}

export interface UserRoleRecord {
  id: string;
  appId: string;
  userId: string;
  roleId: string;
}

export interface RefreshTokenRecord {
  id: string;
  appId: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt?: string;
  replacedBy?: string;
}

export interface AdminSessionRecord {
  id: string;
  username: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuditLogRecord {
  id: string;
  appId: string;
  actorUserId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  resourceOwnerUserId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface NotificationJobRecord {
  id: string;
  appId: string;
  recipientUserId: string;
  channel: "email" | "sms" | "push";
  payload: Record<string, unknown>;
  status: NotificationStatus;
  retryCount: number;
}

export interface FailedEventRecord {
  id: string;
  appId: string;
  eventType: string;
  payload: Record<string, unknown>;
  errorMessage: string;
  retryCount: number;
  nextRetryAt: string;
  createdAt: string;
}

export interface AppConfigRecord {
  id: string;
  appId: string;
  configKey: string;
  configValue: string;
  updatedAt: string;
}

export interface ConfigRevisionMeta {
  revision: number;
  desc: string;
  createdAt: string;
}

export interface ConfigRevisionRecord<T = string> extends ConfigRevisionMeta {
  content: T;
}

export interface AnalyticsEventRecord {
  id: string;
  appId: string;
  userId: string;
  platform: Platform;
  sessionId: string;
  pageKey: string;
  eventName: EventName;
  durationMs?: number;
  occurredAt: string;
  receivedAt: string;
  metadata: Record<string, unknown>;
}

export interface FileRecord {
  id: string;
  appId: string;
  ownerUserId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  status: FileStatus;
  createdAt: string;
}

export type ClientLogUploadTaskStatus = "PENDING" | "COMPLETED" | "CANCELLED";

export interface ClientLogUploadTaskRecord {
  id: string;
  appId: string;
  userId?: string;
  keyId: string;
  fromTsMs?: number;
  toTsMs?: number;
  maxLines?: number;
  maxBytes?: number;
  status: ClientLogUploadTaskStatus;
  createdAt: string;
  expiresAt?: string;
  uploadedAt?: string;
}

export interface ClientLogUploadRecord {
  id: string;
  taskId: string;
  appId: string;
  userId: string;
  keyId: string;
  encryption: "aes-256-gcm";
  contentEncoding: "ndjson+gzip";
  nonceBase64: string;
  lineCountReported?: number;
  plainBytesReported?: number;
  compressedBytesReported?: number;
  encryptedBytes: number;
  acceptedCount: number;
  rejectedCount: number;
  uploadedAt: string;
}

export interface ClientLogLineRecord {
  id: string;
  uploadId: string;
  taskId: string;
  appId: string;
  userId: string;
  timestampMs?: number;
  level?: string;
  message?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface DatabaseSeed {
  apps?: AppRecord[];
  users?: UserRecord[];
  appUsers?: AppUserRecord[];
  roles?: RoleRecord[];
  permissions?: PermissionRecord[];
  rolePermissions?: RolePermissionRecord[];
  userRoles?: UserRoleRecord[];
  refreshTokens?: RefreshTokenRecord[];
  auditLogs?: AuditLogRecord[];
  notificationJobs?: NotificationJobRecord[];
  failedEvents?: FailedEventRecord[];
  appConfigs?: AppConfigRecord[];
  analyticsEvents?: AnalyticsEventRecord[];
  files?: FileRecord[];
  clientLogUploadTasks?: ClientLogUploadTaskRecord[];
  clientLogUploads?: ClientLogUploadRecord[];
  clientLogLines?: ClientLogLineRecord[];
}

export interface AccessTokenPayload {
  sub: string;
  app_id: string;
  type: "access";
  jti: string;
  ver: number;
  iat: number;
  exp: number;
}

export interface AuthContext {
  userId: string;
  appId: string;
  tokenId: string;
  tokenVersion: number;
  expiresAt: string;
}

export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: unknown;
  hostname?: string;
  ipAddress?: string;
  trustedProxy?: boolean;
  requestId?: string;
  cookies?: Record<string, string>;
  auth?: AuthContext;
  adminSession?: AdminSessionRecord | null;
}

export interface HttpResponse<T> {
  statusCode: number;
  headers?: Record<string, string>;
  body: ResultEnvelope<T>;
}

export interface ResultEnvelope<T> {
  code: string;
  message: string;
  data: T;
  requestId: string;
}

export interface LoginCommand {
  appId: string;
  account: string;
  password: string;
}

export interface RefreshCommand {
  appId?: string;
  refreshToken?: string;
  cookieRefreshToken?: string;
}

export interface LogoutCommand {
  appId: string;
  scope: "current" | "all";
  refreshToken?: string;
  cookieRefreshToken?: string;
}

export interface RegisterEmailCodeCommand {
  appId: string;
  email: string;
  ipAddress: string;
  locale: string;
  region: TencentSesRegion;
}

export interface RegisterCommand {
  appId: string;
  email: string;
  password: string;
  emailCode: string;
  ipAddress: string;
}

export interface EmailLoginCodeCommand {
  appId: string;
  email: string;
  ipAddress: string;
  locale: string;
  region: TencentSesRegion;
}

export interface EmailLoginCommand {
  appId: string;
  email: string;
  emailCode: string;
  ipAddress: string;
}

export interface PasswordEmailCodeCommand {
  appId: string;
  email: string;
  ipAddress: string;
  locale: string;
  region: TencentSesRegion;
}

export interface ResetPasswordCommand {
  appId: string;
  email: string;
  emailCode: string;
  password: string;
  ipAddress: string;
}

export interface ChangePasswordCommand {
  appId: string;
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export interface AdminAppLogSecretSummary {
  keyId: string;
  secretMasked: string;
  updatedAt: string;
}

export interface AdminAppSummary {
  appId: string;
  appCode: string;
  appName: string;
  appNameI18n: AppNameI18n;
  status: AppStatus;
  canDelete: boolean;
  logSecret: AdminAppLogSecretSummary;
}

export interface AdminBootstrapResult {
  adminUser: string;
  apps: AdminAppSummary[];
  sessionExpiresAt?: string;
}

export interface AdminAppLogSecretRevealDocument {
  app: AdminAppSummary;
  keyId: string;
  secret: string;
  updatedAt: string;
}

export interface AdminSensitiveOperationCodeRequestDocument {
  operation: string;
  recipientEmailMasked: string;
  cooldownSeconds: number;
  expiresInSeconds: number;
}

export interface AdminSensitiveOperationGrantDocument {
  operation: string;
  granted: true;
  expiresAt: string;
}

export interface AdminConfigDocument {
  app: AdminAppSummary;
  configKey: string;
  rawJson: string;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface I18nSettings {
  defaultLocale: string;
  supportedLocales: string[];
  fallbackLocales: Record<string, string[]>;
}

export interface AppI18nConfigDocument {
  configKey: string;
  config: I18nSettings;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AdminAppI18nDocument extends AppI18nConfigDocument {
  app: AdminAppSummary;
}

export interface EmailServiceTemplateConfig {
  locale: string;
  templateId: number;
  name: string;
  subject: string;
}

export interface EmailSenderConfig {
  id: string;
  address: string;
}

export interface EmailServiceRegionConfig {
  region: TencentSesRegion;
  sender?: EmailSenderConfig | null;
  templates: EmailServiceTemplateConfig[];
}

export interface EmailServiceConfig {
  enabled: boolean;
  regions: EmailServiceRegionConfig[];
}

export interface AdminEmailServiceDocument {
  app: AdminAppSummary;
  configKey: string;
  config: EmailServiceConfig;
  resolvedRegion: TencentSesRegion;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface AdminEmailTestSendCommand {
  recipientEmail: string;
  region: TencentSesRegion;
  templateId: number;
  appName: string;
  code: string;
  expireMinutes: number;
}

export interface AdminEmailTestSendDocument {
  executedAt: string;
  cooldownSeconds: number;
  recipientEmail: string;
  clientRegion: TencentSesRegion;
  resolvedRegion: TencentSesRegion;
  sender: {
    id: string;
    address: string;
    region: TencentSesRegion;
  };
  template: {
    locale: string;
    templateId: number;
    name: string;
    subject: string;
  };
  templateData: {
    appName: string;
    expireMinutes: number;
    code: string;
  };
  provider: "tencent_ses";
  providerRequestId?: string;
  providerMessageId?: string;
  debug?: {
    request: {
      endpoint: string;
      method: "POST";
      clientRegion: TencentSesRegion;
      resolvedRegion: TencentSesRegion;
      headers: Record<string, string>;
      credentials: {
        secretIdMasked: string;
        secretKeyMasked: string;
      };
      body: Record<string, unknown>;
    };
    response?: {
      statusCode: number;
      ok: boolean;
      body: unknown;
      requestId?: string;
      messageId?: string;
      errorCode?: string;
      errorMessage?: string;
    };
  };
}

export interface PasswordEntry {
  key: string;
  desc: string;
  value: string;
  valueMd5?: string;
  updatedAt?: string;
}

export interface AdminPasswordDocument {
  app: AdminAppSummary;
  configKey: string;
  items: PasswordEntry[];
  updatedAt?: string;
}

export interface AdminPasswordRevealDocument {
  app: AdminAppSummary;
  configKey: string;
  key: string;
  desc: string;
  value: string;
  updatedAt?: string;
}

export interface LlmProviderConfig {
  key: string;
  label: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export interface LlmModelRouteConfig {
  provider: string;
  providerModel: string;
  enabled: boolean;
  weight: number;
}

export interface LlmModelConfig {
  key: string;
  label: string;
  kind: LlmModelKind;
  strategy: LlmRoutingStrategy;
  routes: LlmModelRouteConfig[];
}

export interface LlmServiceConfig {
  enabled: boolean;
  defaultModelKey: string;
  providers: LlmProviderConfig[];
  models: LlmModelConfig[];
}

export interface LlmRouteRuntimeStatus {
  provider: string;
  providerModel: string;
  enabled: boolean;
  weight: number;
  totalCalls: number;
  sampleSize: number;
  successRate: number;
  healthScore: number;
  effectiveProbability?: number;
  lastErrorAt?: string;
}

export interface LlmModelRuntimeStatus {
  key: string;
  kind: LlmModelKind;
  strategy: LlmRoutingStrategy;
  routes: LlmRouteRuntimeStatus[];
}

export interface LlmRuntimeSnapshot {
  generatedAt: string;
  models: LlmModelRuntimeStatus[];
}

export interface AdminLlmServiceDocument {
  app: AdminAppSummary;
  configKey: string;
  config: LlmServiceConfig;
  runtime: LlmRuntimeSnapshot;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}

export interface LlmMetricsSummary {
  requestCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgFirstByteLatencyMs: number;
  avgTotalLatencyMs: number;
  p95FirstByteLatencyMs: number;
  p95TotalLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmHourlySeriesItem extends LlmMetricsSummary {
  hour: string;
}

export interface LlmModelMetricsGroup {
  modelKey: string;
  label: string;
  summary: LlmMetricsSummary;
  items: LlmHourlySeriesItem[];
}

export interface LlmRouteMetricsGroup {
  modelKey: string;
  provider: string;
  providerModel: string;
  summary: LlmMetricsSummary;
  items: LlmHourlySeriesItem[];
}

export interface AdminLlmMetricsDocument {
  timezone: string;
  range: LlmMetricsRange;
  summary: LlmMetricsSummary;
  models: LlmModelMetricsGroup[];
}

export interface AdminLlmModelMetricsDocument {
  timezone: string;
  range: LlmMetricsRange;
  modelKey: string;
  label: string;
  summary: LlmMetricsSummary;
  routes: LlmRouteMetricsGroup[];
}

export interface AdminLlmSmokeTestSummary {
  totalCount: number;
  attemptedCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  successRate: number;
}

export interface AdminLlmSmokeTestRequestPayload {
  modelKind: LlmModelKind;
  provider: string;
  modelKey: string;
  providerModel: string;
  baseUrl: string;
  timeoutMs: number;
  messages?: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  input?: string[];
  temperature?: number;
  maxTokens?: number;
  providerOptions: Record<string, unknown>;
}

export interface AdminLlmSmokeTestResponsePayload {
  modelKind: LlmModelKind;
  provider: string;
  modelKey: string;
  providerModel: string;
  text?: string;
  reasoningText?: string;
  finishReason?: string;
  vectorCount?: number;
  dimensions?: number;
  vectorPreview?: Array<{
    index: number;
    embedding: number[];
  }>;
  providerRequestId?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AdminLlmSmokeTestErrorPayload {
  name: string;
  message: string;
  code?: string;
  statusCode?: number;
  details?: unknown;
  stackPreview?: string[];
}

export interface AdminLlmSmokeTestSkipPayload {
  reason: string;
  configured: boolean;
  providerEnabled: boolean;
  routeEnabled?: boolean;
}

export interface AdminLlmSmokeTestDetails {
  request?: AdminLlmSmokeTestRequestPayload;
  response?: AdminLlmSmokeTestResponsePayload;
  error?: AdminLlmSmokeTestErrorPayload;
  skip?: AdminLlmSmokeTestSkipPayload;
}

export interface AdminLlmSmokeTestItem {
  modelKind: LlmModelKind;
  modelKey: string;
  modelLabel: string;
  provider: string;
  providerLabel: string;
  providerModel: string;
  configured: boolean;
  status: LlmSmokeTestStatus;
  latencyMs?: number;
  message: string;
  responsePreview?: string;
  details: AdminLlmSmokeTestDetails;
}

export interface AdminLlmSmokeTestDocument {
  executedAt: string;
  cooldownSeconds: number;
  summary: AdminLlmSmokeTestSummary;
  items: AdminLlmSmokeTestItem[];
}

export interface AdminDeleteAppResult {
  deleted: true;
  appId: string;
}

export interface AuthSession {
  userId: string;
  appId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthenticatedUserProfile {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  avatarUrl: string | null;
}

export interface AuthSuccessPayload {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  user: AuthenticatedUserProfile;
}

export interface CurrentUserDocument {
  appId: string;
  user: AuthenticatedUserProfile;
}

export interface RegisterEmailCodeResult {
  accepted: true;
  cooldownSeconds: number;
  expiresInSeconds: number;
}

export interface CreateQrLoginCommand {
  appId: string;
}

export interface ConfirmQrLoginCommand {
  appId: string;
  loginId: string;
  scanToken: string;
  userId: string;
}

export interface PollQrLoginCommand {
  appId: string;
  loginId: string;
  pollToken: string;
}

export interface QrLoginCreateResult {
  loginId: string;
  qrContent: string;
  pollToken: string;
  expiresInSeconds: number;
  pollIntervalMs: number;
}

export interface QrLoginConfirmResult {
  confirmed: true;
}

export type QrLoginPollResult =
  | {
      status: "PENDING";
      expiresInSeconds: number;
      pollIntervalMs: number;
    }
  | {
      status: "CONFIRMED";
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      userId: string;
    };

export interface AnalyticsEventInput {
  platform: Platform;
  sessionId: string;
  pageKey: string;
  eventName: EventName;
  durationMs?: number;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export interface MetricsOverviewItem {
  date: string;
  dau: number;
  newUsers: number;
}

export interface PageMetricItem {
  pageKey: string;
  platform: Platform;
  uv: number;
  sessionCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

export interface FilePresignResult {
  uploadUrl: string;
  storageKey: string;
  expireAt: string;
}

export interface FileConfirmResult {
  downloadUrl: string;
  storageKey: string;
}

export type LogPullTaskResult =
  | {
      shouldUpload: false;
    }
  | {
      shouldUpload: true;
      taskId: string;
      fromTsMs?: number;
      toTsMs?: number;
      maxLines?: number;
      maxBytes?: number;
      keyId: string;
    };

export interface LogUploadResult {
  taskId: string;
  acceptedCount: number;
  rejectedCount: number;
}

export interface QueueJob<T = Record<string, unknown>> {
  id: string;
  name: string;
  payload: T;
  attemptsMade: number;
  maxAttempts: number;
  backoffMs: number;
  availableAt: string;
  failedReason?: string;
}

export interface LogRecord {
  timestamp: string;
  level: "info" | "warn" | "error";
  service: string;
  message: string;
  requestId?: string;
  appId?: string;
  userId?: string;
  path?: string;
  statusCode?: number;
  latencyMs?: number;
  jobName?: string;
  jobId?: string;
  error?: string;
}
