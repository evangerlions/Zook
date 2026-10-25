import type { UserRecord } from "../../../shared/types.ts";
import { parseUser } from "./postgres-row-parsers.ts";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** Global identity queries use the same active connection as authorization and app membership. */
export class PostgresUserStore {
  constructor(private readonly query: Query) {}
  async findUserById(userId: string): Promise<UserRecord | undefined> {
    const result = await this.query(
      "SELECT id, email, phone, password_hash, password_algo, status, created_at FROM zook_users WHERE id = $1 LIMIT 1",
      [userId],
    );
    return result.rows[0] ? parseUser(result.rows[0]) : undefined;
  }

  async findUserByAccount(account: string): Promise<UserRecord | undefined> {
    const normalized = account.trim().toLowerCase();
    const result = await this.query(
      `SELECT id, email, phone, password_hash, password_algo, status, created_at
       FROM zook_users
       WHERE lower(coalesce(email, '')) = $1 OR lower(coalesce(phone, '')) = $1
       LIMIT 1`,
      [normalized],
    );
    return result.rows[0] ? parseUser(result.rows[0]) : undefined;
  }

  async findUserByPhone(phone: string): Promise<UserRecord | undefined> {
    const normalized = phone.trim().toLowerCase();
    const result = await this.query(
      `SELECT id, email, phone, password_hash, password_algo, status, created_at
       FROM zook_users
       WHERE lower(coalesce(phone, '')) = $1
       LIMIT 1`,
      [normalized],
    );
    return result.rows[0] ? parseUser(result.rows[0]) : undefined;
  }

  async insertUser(record: UserRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_users (id, email, phone, password_hash, password_algo, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         password_hash = EXCLUDED.password_hash,
         password_algo = EXCLUDED.password_algo,
         status = EXCLUDED.status,
         created_at = EXCLUDED.created_at,
         updated_at = NOW()`,
      [record.id, record.email ?? null, record.phone ?? null, record.passwordHash, record.passwordAlgo, record.status, record.createdAt],
    );
  }

  async updateUserEmail(userId: string, email: string): Promise<void> {
    await this.query(
      "UPDATE zook_users SET email = $2, updated_at = NOW() WHERE id = $1",
      [userId, email],
    );
  }

  async updateUserPassword(userId: string, passwordHash: string, passwordAlgo: string): Promise<void> {
    await this.query(
      "UPDATE zook_users SET password_hash = $2, password_algo = $3, updated_at = NOW() WHERE id = $1",
      [userId, passwordHash, passwordAlgo],
    );
  }

}
