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
export type EmailProvider = "tencent_ses";
export type EmailRegionMode = "auto" | "manual";
export type ErrorCode =
  | "ADMIN_BASIC_AUTH_REQUIRED"
  | "ADMIN_CONFIG_INVALID_JSON"
  | "ADMIN_APP_ALREADY_EXISTS"
  | "ADMIN_APP_ID_RESERVED"
  | "ADMIN_APP_DELETE_REQUIRES_EMPTY_CONFIG"
  | "ADMIN_EMAIL_SERVICE_INVALID"
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
}

export interface EmailServiceVerificationConfig {
  subject: string;
  templateId: number;
  templateDataKey: string;
  triggerType: 0 | 1;
}

export interface EmailServiceConfig {
  enabled: boolean;
  provider: EmailProvider;
  regionMode: EmailRegionMode;
  manualRegion?: TencentSesRegion;
  secretId: string;
  secretKey: string;
  fromEmailAddress: string;
  replyToAddresses?: string;
  verification: EmailServiceVerificationConfig;
}

export interface AdminEmailServiceDocument {
  app: AdminAppSummary;
  configKey: string;
  config: EmailServiceConfig;
  resolvedRegion: TencentSesRegion;
  updatedAt?: string;
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
