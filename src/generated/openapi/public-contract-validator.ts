import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type {
  AnalyticsBatchRequest,
  ChangePasswordRequest,
  EmailCodeRequest,
  EmailLoginRequest,
  FileConfirmRequest,
  FilePresignRequest,
  LogAckRequest,
  LogFailRequest,
  NotificationSendRequest,
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
  LogAckRequestSchema,
  LogFailRequestSchema,
  LogoutRequestSchema,
  NotificationSendRequestSchema,
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
