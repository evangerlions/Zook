import { forbidden, unauthorized } from "../../shared/errors.ts";
import { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import type { AuthenticatedUserProfile, UserRecord } from "../../shared/types.ts";

/**
 * UserService centralizes account lookup and cross-app user status checks.
 */
export class UserService {
  constructor(private readonly database: ApplicationDatabase) {}

  async findByAccount(account: string) {
    return await this.database.findUserByAccount(account);
  }

  async getById(userId: string) {
    const user = await this.database.findUserById(userId);
    if (!user) {
      unauthorized("AUTH_INVALID_CREDENTIAL", "The account does not exist.");
    }

    if (user.status === "BLOCKED") {
      forbidden("AUTH_USER_BLOCKED", "The user is blocked across all apps.");
    }

    return user;
  }

  async getProfile(userId: string): Promise<AuthenticatedUserProfile> {
    const user = await this.getById(userId);
    return this.toProfile(user);
  }

  private toProfile(user: UserRecord): AuthenticatedUserProfile {
    return {
      id: user.id,
      name: this.deriveName(user),
      email: user.email,
      phone: user.phone,
      avatarUrl: null,
      hasPassword: this.hasPassword(user),
    };
  }

  private hasPassword(user: UserRecord): boolean {
    return user.passwordAlgo !== "email-code-only";
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
