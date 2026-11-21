import { timingSafeEqual } from "node:crypto";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { HttpRequest } from "../shared/types.ts";
import { ApplicationError } from "../shared/errors.ts";
export function requireAdminSession(request: HttpRequest) {
  if (!request.adminSession)
    throw new ApplicationError(
      401,
      "ADMIN_AUTH_REQUIRED",
      "Admin session login is required.",
    );
  return request.adminSession;
}
export async function assertActiveProductOwner(
  database: ApplicationDatabase,
  appId: string,
  userId: string,
) {
  const [member, user] = await Promise.all([
    database.findAppUser(appId, userId),
    database.findUserById(userId),
  ]);
  if (member?.status !== "ACTIVE" || user?.status !== "ACTIVE")
    throw new ApplicationError(
      403,
      "APP_SCOPE_FORBIDDEN",
      "The product owner is not active.",
    );
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function parseBasicAuthorization(
  headerValue?: string,
): { username: string; password: string } | null {
  if (!headerValue || !headerValue.startsWith("Basic ")) {
    return null;
  }
  try {
    const decoded = Buffer.from(headerValue.slice("Basic ".length), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex <= 0) {
      return null;
    }
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}
