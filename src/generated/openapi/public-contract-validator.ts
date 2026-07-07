import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type {
  AnalyticsBatchRequest,
  ChangePasswordRequest,
  EmailCodeRequest,
  EmailLoginRequest,
  FileConfirmRequest,
  FilePresignRequest,
  FrogSleepDeviceRegisterRequest,
  FrogSleepEmailCodeRequest,
  FrogSleepEmailLoginRequest,
  FrogSleepEmailRegisterRequest,
  FrogSleepEntitlementData,
  FrogSleepFocusAchievementNotifyRequest,
  FrogSleepFocusMessageRequest,
  FrogSleepFocusProfileRequest,
  FrogSleepFocusSessionRequest,
  FrogSleepInviteAcceptRequest,
  FrogSleepInviteCreateRequest,
  FrogSleepPasswordChangeRequest,
  FrogSleepPasswordLoginRequest,
  FrogSleepPasswordResetConfirmRequest,
  FrogSleepPasswordResetRequest,
  FrogSleepProgressSnapshotRequest,
  FrogSleepSharedSleepEventRequest,
  FrogSleepSharedSleepSessionRequest,
  FrogSleepSleepPreferencesRequest,
  FrogSleepSleepReportRequest,
  FrogSleepTokenRefreshRequest,
  LogAckRequest,
  LogFailRequest,
  NotificationSendRequest,
  OneClickLoginRequest,
  PasswordLoginRequest,
  PublicConfigData,
  QrLoginCreateRequest,
  RegisterRequest,
  RefreshRequest,
  ResetPasswordRequest,
  LogoutRequest,
  SetPasswordRequest,
  SmsCodeRequest,
  SmsLoginRequest,
} from "./public-contracts.generated.ts";
import {
  AnalyticsBatchRequestSchema,
  ChangePasswordRequestSchema,
  EmailCodeRequestSchema,
  EmailLoginRequestSchema,
  FileConfirmRequestSchema,
  FilePresignRequestSchema,
  FrogSleepDeviceRegisterRequestSchema,
  FrogSleepEmailCodeRequestSchema,
  FrogSleepEmailLoginRequestSchema,
  FrogSleepEmailRegisterRequestSchema,
  FrogSleepEntitlementDataSchema,
  FrogSleepFocusAchievementNotifyRequestSchema,
  FrogSleepFocusMessageRequestSchema,
  FrogSleepFocusProfileRequestSchema,
  FrogSleepFocusSessionRequestSchema,
  FrogSleepInviteAcceptRequestSchema,
  FrogSleepInviteCreateRequestSchema,
  FrogSleepPasswordChangeRequestSchema,
  FrogSleepPasswordLoginRequestSchema,
  FrogSleepPasswordResetConfirmRequestSchema,
  FrogSleepPasswordResetRequestSchema,
  FrogSleepProgressSnapshotRequestSchema,
  FrogSleepSharedSleepEventRequestSchema,
  FrogSleepSharedSleepSessionRequestSchema,
  FrogSleepSleepPreferencesRequestSchema,
  FrogSleepSleepReportRequestSchema,
  FrogSleepTokenRefreshRequestSchema,
  LogAckRequestSchema,
  LogFailRequestSchema,
  LogoutRequestSchema,
  NotificationSendRequestSchema,
  OneClickLoginRequestSchema,
  PasswordLoginRequestSchema,
  PublicConfigDataSchema,
  QrLoginCreateRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  ResetPasswordRequestSchema,
  SetPasswordRequestSchema,
  SmsCodeRequestSchema,
  SmsLoginRequestSchema,
} from "./public-contracts.generated.ts";

type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[]; details: ErrorObject[] };

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});
addFormats(ajv);

function validateWithSchema<T>(
  validator: ValidateFunction,
  input: unknown,
): ValidationResult<T> {
  if (validator(input)) {
    return { ok: true, data: input as T };
  }
  const errors =
    validator.errors?.map((item) => `${item.instancePath || "/"} ${item.message || "is invalid"}`) ??
    ["payload is invalid"];
  return { ok: false, errors, details: validator.errors ?? [] };
}

const validators = {
  passwordLogin: ajv.compile(PasswordLoginRequestSchema),
  emailCode: ajv.compile(EmailCodeRequestSchema),
  emailLogin: ajv.compile(EmailLoginRequestSchema),
  smsCode: ajv.compile(SmsCodeRequestSchema),
  smsLogin: ajv.compile(SmsLoginRequestSchema),
  oneClickLogin: ajv.compile(OneClickLoginRequestSchema),
  setPassword: ajv.compile(SetPasswordRequestSchema),
  resetPassword: ajv.compile(ResetPasswordRequestSchema),
  changePassword: ajv.compile(ChangePasswordRequestSchema),
  register: ajv.compile(RegisterRequestSchema),
  qrLoginCreate: ajv.compile(QrLoginCreateRequestSchema),
  refresh: ajv.compile(RefreshRequestSchema),
  logout: ajv.compile(LogoutRequestSchema),
  analyticsBatch: ajv.compile(AnalyticsBatchRequestSchema),
  filePresign: ajv.compile(FilePresignRequestSchema),
  fileConfirm: ajv.compile(FileConfirmRequestSchema),
  frogSleepPasswordLogin: ajv.compile(FrogSleepPasswordLoginRequestSchema),
  frogSleepEmailCode: ajv.compile(FrogSleepEmailCodeRequestSchema),
  frogSleepEmailLogin: ajv.compile(FrogSleepEmailLoginRequestSchema),
  frogSleepEmailRegister: ajv.compile(FrogSleepEmailRegisterRequestSchema),
  frogSleepPasswordReset: ajv.compile(FrogSleepPasswordResetRequestSchema),
  frogSleepPasswordResetConfirm: ajv.compile(FrogSleepPasswordResetConfirmRequestSchema),
  frogSleepPasswordChange: ajv.compile(FrogSleepPasswordChangeRequestSchema),
  frogSleepTokenRefresh: ajv.compile(FrogSleepTokenRefreshRequestSchema),
  frogSleepDeviceRegister: ajv.compile(FrogSleepDeviceRegisterRequestSchema),
  frogSleepInviteCreate: ajv.compile(FrogSleepInviteCreateRequestSchema),
  frogSleepInviteAccept: ajv.compile(FrogSleepInviteAcceptRequestSchema),
  frogSleepSleepPreferences: ajv.compile(FrogSleepSleepPreferencesRequestSchema),
  frogSleepSharedSleepSession: ajv.compile(FrogSleepSharedSleepSessionRequestSchema),
  frogSleepSharedSleepEvent: ajv.compile(FrogSleepSharedSleepEventRequestSchema),
  frogSleepFocusProfile: ajv.compile(FrogSleepFocusProfileRequestSchema),
  frogSleepFocusSession: ajv.compile(FrogSleepFocusSessionRequestSchema),
  frogSleepFocusAchievementNotify: ajv.compile(FrogSleepFocusAchievementNotifyRequestSchema),
  frogSleepFocusMessage: ajv.compile(FrogSleepFocusMessageRequestSchema),
  frogSleepSleepReport: ajv.compile(FrogSleepSleepReportRequestSchema),
  frogSleepProgressSnapshot: ajv.compile(FrogSleepProgressSnapshotRequestSchema),
  frogSleepEntitlement: ajv.compile(FrogSleepEntitlementDataSchema),
  logAck: ajv.compile(LogAckRequestSchema),
  logFail: ajv.compile(LogFailRequestSchema),
  notificationSend: ajv.compile(NotificationSendRequestSchema),
  publicConfig: ajv.compile(PublicConfigDataSchema),
} as const;

export const PublicContractValidator = {
  validatePasswordLogin(input: unknown) {
    return validateWithSchema<PasswordLoginRequest>(validators.passwordLogin, input);
  },
  validateEmailCode(input: unknown) {
    return validateWithSchema<EmailCodeRequest>(validators.emailCode, input);
  },
  validateEmailLogin(input: unknown) {
    return validateWithSchema<EmailLoginRequest>(validators.emailLogin, input);
  },
  validateSmsCode(input: unknown) {
    return validateWithSchema<SmsCodeRequest>(validators.smsCode, input);
  },
  validateSmsLogin(input: unknown) {
    return validateWithSchema<SmsLoginRequest>(validators.smsLogin, input);
  },
  validateOneClickLogin(input: unknown) {
    return validateWithSchema<OneClickLoginRequest>(validators.oneClickLogin, input);
  },
  validateSetPassword(input: unknown) {
    return validateWithSchema<SetPasswordRequest>(validators.setPassword, input);
  },
  validateResetPassword(input: unknown) {
    return validateWithSchema<ResetPasswordRequest>(validators.resetPassword, input);
  },
  validateChangePassword(input: unknown) {
    return validateWithSchema<ChangePasswordRequest>(validators.changePassword, input);
  },
  validateRegister(input: unknown) {
    return validateWithSchema<RegisterRequest>(validators.register, input);
  },
  validateQrLoginCreate(input: unknown) {
    return validateWithSchema<QrLoginCreateRequest>(validators.qrLoginCreate, input);
  },
  validateRefresh(input: unknown) {
    return validateWithSchema<RefreshRequest>(validators.refresh, input);
  },
  validateLogout(input: unknown) {
    return validateWithSchema<LogoutRequest>(validators.logout, input);
  },
  validateAnalyticsBatch(input: unknown) {
    return validateWithSchema<AnalyticsBatchRequest>(validators.analyticsBatch, input);
  },
  validateFilePresign(input: unknown) {
    return validateWithSchema<FilePresignRequest>(validators.filePresign, input);
  },
  validateFileConfirm(input: unknown) {
    return validateWithSchema<FileConfirmRequest>(validators.fileConfirm, input);
  },
  validateFrogSleepPasswordLogin(input: unknown) {
    return validateWithSchema<FrogSleepPasswordLoginRequest>(validators.frogSleepPasswordLogin, input);
  },
  validateFrogSleepEmailCode(input: unknown) {
    return validateWithSchema<FrogSleepEmailCodeRequest>(validators.frogSleepEmailCode, input);
  },
  validateFrogSleepEmailLogin(input: unknown) {
    return validateWithSchema<FrogSleepEmailLoginRequest>(validators.frogSleepEmailLogin, input);
  },
  validateFrogSleepEmailRegister(input: unknown) {
    return validateWithSchema<FrogSleepEmailRegisterRequest>(validators.frogSleepEmailRegister, input);
  },
  validateFrogSleepPasswordReset(input: unknown) {
    return validateWithSchema<FrogSleepPasswordResetRequest>(validators.frogSleepPasswordReset, input);
  },
  validateFrogSleepPasswordResetConfirm(input: unknown) {
    return validateWithSchema<FrogSleepPasswordResetConfirmRequest>(validators.frogSleepPasswordResetConfirm, input);
  },
  validateFrogSleepPasswordChange(input: unknown) {
    return validateWithSchema<FrogSleepPasswordChangeRequest>(validators.frogSleepPasswordChange, input);
  },
  validateFrogSleepTokenRefresh(input: unknown) {
    return validateWithSchema<FrogSleepTokenRefreshRequest>(validators.frogSleepTokenRefresh, input);
  },
  validateFrogSleepDeviceRegister(input: unknown) {
    return validateWithSchema<FrogSleepDeviceRegisterRequest>(validators.frogSleepDeviceRegister, input);
  },
  validateFrogSleepInviteCreate(input: unknown) {
    return validateWithSchema<FrogSleepInviteCreateRequest>(validators.frogSleepInviteCreate, input);
  },
  validateFrogSleepInviteAccept(input: unknown) {
    return validateWithSchema<FrogSleepInviteAcceptRequest>(validators.frogSleepInviteAccept, input);
  },
  validateFrogSleepSleepPreferences(input: unknown) {
    return validateWithSchema<FrogSleepSleepPreferencesRequest>(validators.frogSleepSleepPreferences, input);
  },
  validateFrogSleepSharedSleepSession(input: unknown) {
    return validateWithSchema<FrogSleepSharedSleepSessionRequest>(validators.frogSleepSharedSleepSession, input);
  },
  validateFrogSleepSharedSleepEvent(input: unknown) {
    return validateWithSchema<FrogSleepSharedSleepEventRequest>(validators.frogSleepSharedSleepEvent, input);
  },
  validateFrogSleepFocusProfile(input: unknown) {
    return validateWithSchema<FrogSleepFocusProfileRequest>(validators.frogSleepFocusProfile, input);
  },
  validateFrogSleepFocusSession(input: unknown) {
    return validateWithSchema<FrogSleepFocusSessionRequest>(validators.frogSleepFocusSession, input);
  },
  validateFrogSleepFocusAchievementNotify(input: unknown) {
    return validateWithSchema<FrogSleepFocusAchievementNotifyRequest>(validators.frogSleepFocusAchievementNotify, input);
  },
  validateFrogSleepFocusMessage(input: unknown) {
    return validateWithSchema<FrogSleepFocusMessageRequest>(validators.frogSleepFocusMessage, input);
  },
  validateFrogSleepSleepReport(input: unknown) {
    return validateWithSchema<FrogSleepSleepReportRequest>(validators.frogSleepSleepReport, input);
  },
  validateFrogSleepProgressSnapshot(input: unknown) {
    return validateWithSchema<FrogSleepProgressSnapshotRequest>(validators.frogSleepProgressSnapshot, input);
  },
  validateFrogSleepEntitlement(input: unknown) {
    return validateWithSchema<FrogSleepEntitlementData>(validators.frogSleepEntitlement, input);
  },
  validateLogAck(input: unknown) {
    return validateWithSchema<LogAckRequest>(validators.logAck, input);
  },
  validateLogFail(input: unknown) {
    return validateWithSchema<LogFailRequest>(validators.logFail, input);
  },
  validateNotificationSend(input: unknown) {
    return validateWithSchema<NotificationSendRequest>(validators.notificationSend, input);
  },
  validatePublicConfigData(input: unknown) {
    return validateWithSchema<PublicConfigData>(validators.publicConfig, input);
  },
};
