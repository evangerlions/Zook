import { forbidden, unauthorized } from "../../shared/errors.ts";
import { InMemoryDatabase } from "../../infrastructure/database/prisma/in-memory-database.ts";

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
}
