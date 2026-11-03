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
