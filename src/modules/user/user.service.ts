import { forbidden, unauthorized } from "../../shared/errors.ts";
import { InMemoryDatabase } from "../../infrastructure/database/prisma/in-memory-database.ts";
import type { AuthenticatedUserProfile, UserRecord } from "../../shared/types.ts";

/**
 * UserService centralizes account lookup and cross-app user status checks.
 */
export class UserService {
  constructor(private readonly database: InMemoryDatabase) {}

  findByAccount(account: string) {
    return this.database.findUserByAccount(account);
  }

  getById(userId: string) {
    const user = this.database.findUserById(userId);
    if (!user) {
      unauthorized("AUTH_INVALID_CREDENTIAL", "The account does not exist.");
    }

    if (user.status === "BLOCKED") {
      forbidden("AUTH_USER_BLOCKED", "The user is blocked across all apps.");
    }

    return user;
  }

  getProfile(userId: string): AuthenticatedUserProfile {
    const user = this.getById(userId);
    return this.toProfile(user);
  }

  private toProfile(user: UserRecord): AuthenticatedUserProfile {
    return {
      id: user.id,
      name: this.deriveName(user),
      email: user.email,
      phone: user.phone,
      avatarUrl: null,
    };
  }

  private deriveName(user: UserRecord): string {
    const emailName = user.email?.split("@")[0]?.trim();
    if (emailName) {
      return emailName;
    }

    const phoneName = user.phone?.trim();
    if (phoneName) {
      return phoneName;
    }

    return user.id;
  }
}
