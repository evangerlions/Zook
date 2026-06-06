import type {
  AccountDeletionData as GeneratedAccountDeletionData,
  AuthSessionData as GeneratedAuthSessionData,
  CurrentUserData as GeneratedCurrentUserData,
  QrLoginConfirmData as GeneratedQrLoginConfirmData,
  QrLoginCreateData as GeneratedQrLoginCreateData,
  QrLoginPollData as GeneratedQrLoginPollData,
  UserSummary as GeneratedUserSummary,
} from "../../generated/openapi/public-contracts.generated.ts";
import type { TencentSesRegion } from "./enums.ts";

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

export interface RegisterSmsCodeCommand {
  appId: string;
  phone: string;
  phoneNa?: string;
  ipAddress: string;
  test?: boolean;
}

export interface RegisterBySmsCommand {
  appId: string;
  phone: string;
  phoneNa?: string;
  smsCode: string;
  ipAddress: string;
}

export interface SmsLoginCodeCommand {
  appId: string;
  phone: string;
  phoneNa?: string;
  ipAddress: string;
  test?: boolean;
}

export interface SmsLoginCommand {
  appId: string;
  phone: string;
  phoneNa?: string;
  smsCode: string;
  ipAddress: string;
}

export interface OneClickLoginCommand {
  appId: string;
  phone: string;
  phoneNa?: string;
  ipAddress: string;
}

export interface PasswordSmsCodeCommand {
  appId: string;
  phone: string;
  phoneNa?: string;
  ipAddress: string;
  test?: boolean;
}

export interface ResetPasswordBySmsCommand {
  appId: string;
  phone: string;
  phoneNa?: string;
  smsCode: string;
  password: string;
  ipAddress: string;
}

export interface ChangePasswordCommand {
  appId: string;
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export interface SetPasswordCommand {
  appId: string;
  userId: string;
  password: string;
}

export interface AuthSession {
  userId: string;
  appId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type AuthenticatedUserProfile = GeneratedUserSummary;

export type AuthSuccessPayload = GeneratedAuthSessionData;

export type CurrentUserDocument = GeneratedCurrentUserData;

export type AccountDeletionResult = GeneratedAccountDeletionData;

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

export type QrLoginCreateResult = GeneratedQrLoginCreateData;

export type QrLoginConfirmResult = GeneratedQrLoginConfirmData;

export type QrLoginPollResult = GeneratedQrLoginPollData;
