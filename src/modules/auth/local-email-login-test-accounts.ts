import type { AccountRegion } from "../../shared/types.ts";

export interface LocalEmailLoginTestAccount {
  readonly email: string;
  readonly verificationCode: string;
  readonly accountRegion?: Exclude<AccountRegion, "UNKNOWN">;
}

const LOCAL_EMAIL_LOGIN_VERIFICATION_CODE = "852133";
const LOCAL_EMAIL_LOGIN_TEST_ACCOUNTS: readonly LocalEmailLoginTestAccount[] = [
  {
    email: "evangerlions@gmail.com",
    verificationCode: LOCAL_EMAIL_LOGIN_VERIFICATION_CODE,
  },
  {
    email: "evangerlionss@gmail.com",
    verificationCode: LOCAL_EMAIL_LOGIN_VERIFICATION_CODE,
    accountRegion: "CN",
  },
];

export function findLocalEmailLoginTestAccount(
  email: string,
  ipAddress: string,
): LocalEmailLoginTestAccount | undefined {
  if (!isLocalEmailLoginTestAccountEnabled(ipAddress)) {
    return undefined;
  }
  return LOCAL_EMAIL_LOGIN_TEST_ACCOUNTS.find(
    (account) => account.email === email,
  );
}

export function matchLocalEmailLoginTestAccount(
  email: string,
  verificationCode: string,
  ipAddress: string,
): LocalEmailLoginTestAccount | undefined {
  const account = findLocalEmailLoginTestAccount(email, ipAddress);
  return account?.verificationCode === verificationCode ? account : undefined;
}

function isLocalEmailLoginTestAccountEnabled(ipAddress: string): boolean {
  const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
  const normalizedIp = ipAddress.trim();
  return (
    appEnv === "local" ||
    nodeEnv === "development" ||
    normalizedIp === "127.0.0.1" ||
    normalizedIp === "::1" ||
    normalizedIp === "unknown"
  );
}
