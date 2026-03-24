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
export type LlmMetricsRange = "24h" | "7d" | "30d";
export type LlmSmokeTestStatus = "success" | "failed" | "skipped";
export type ErrorCode =
  | "ADMIN_BASIC_AUTH_REQUIRED"
  | "ADMIN_CONFIG_INVALID_JSON"
  | "ADMIN_APP_ALREADY_EXISTS"
  | "ADMIN_APP_ID_RESERVED"
  | "ADMIN_APP_DELETE_REQUIRES_EMPTY_CONFIG"
  | "ADMIN_EMAIL_SERVICE_INVALID"
  | "ADMIN_LLM_SERVICE_INVALID"
  | "ADMIN_PASSWORD_INVALID"
  | "ADMIN_RATE_LIMITED"
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
  | "REQ_INVALID_BODY"
  | "REQ_INVALID_QUERY"
  | "REQ_INVALID_EVENT"
  | "REQ_DATE_RANGE_INVALID"
  | "SYS_INTERNAL_ERROR";

export interface AppRecord {
  id: string;
  code: string;
  name: string;
  status: AppStatus;
  apiDomain?: string;
  joinMode: JoinMode;
  createdAt: string;
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
}

export interface AccessTokenPayload {
  sub: string;
  app_id: string;
  type: "access";
  jti: string;
  iat: number;
  exp: number;
}

export interface AuthContext {
  userId: string;
  appId: string;
  tokenId: string;
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
}

export interface RegisterCommand {
  appId: string;
  email: string;
  password: string;
  emailCode: string;
  ipAddress: string;
}

export interface AdminAppSummary {
  appId: string;
  appCode: string;
  appName: string;
  status: AppStatus;
  canDelete: boolean;
}

export interface AdminBootstrapResult {
  adminUser: string;
  apps: AdminAppSummary[];
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

export interface EmailServiceTemplateConfig {
  locale: string;
  templateId: number;
  name: string;
}

export interface EmailSenderConfig {
  id: string;
  address: string;
}

export interface EmailServiceConfig {
  enabled: boolean;
  senders: EmailSenderConfig[];
  templates: EmailServiceTemplateConfig[];
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

export interface PasswordEntry {
  key: string;
  desc: string;
  value: string;
  updatedAt?: string;
}

export interface AdminPasswordDocument {
  app: AdminAppSummary;
  configKey: string;
  items: PasswordEntry[];
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

export interface AdminLlmSmokeTestItem {
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
