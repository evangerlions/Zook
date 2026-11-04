import type { FilePurgeTask } from "../../files/file-purge.types.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresFilePurgeStore {
  constructor(readonly query: Query) {}
  async enqueue(appId: string, userId: string, storageKey: string) {
    await this.query(
      "INSERT INTO zook_owner_file_purges(id,app_id,user_id,storage_key) VALUES(gen_random_uuid()::text,$1,$2,$3) ON CONFLICT(app_id,user_id,storage_key) DO UPDATE SET next_attempt_at=NOW()",
      [appId, userId, storageKey],
    );
  }
  async claim(limit: number, now: Date): Promise<FilePurgeTask[]> {
    const result = await this.query(
      `UPDATE zook_owner_file_purges SET attempt=attempt+1,lease_token=gen_random_uuid()::text,lease_until=$3
   WHERE id IN (SELECT id FROM zook_owner_file_purges WHERE next_attempt_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT $2) RETURNING *`,
      [
        now.toISOString(),
        Math.min(20, Math.max(1, limit)),
        new Date(now.getTime() + 45000).toISOString(),
      ],
    );
    return result.rows.map((r) => ({
      id: r.id,
      appId: r.app_id,
      userId: r.user_id,
      storageKey: r.storage_key,
      attempt: r.attempt,
      leaseToken: r.lease_token,
    }));
  }
  async complete(t: FilePurgeTask) {
    await this.query(
      "DELETE FROM zook_owner_file_purges WHERE id=$1 AND lease_token=$2",
      [t.id, t.leaseToken],
    );
  }
  async defer(t: FilePurgeTask, now: Date) {
    await this.query(
      "UPDATE zook_owner_file_purges SET lease_token=NULL,lease_until=NULL,next_attempt_at=$3 WHERE id=$1 AND lease_token=$2",
      [
        t.id,
        t.leaseToken,
        new Date(
          now.getTime() + Math.min(3600, 2 ** Math.min(t.attempt, 12)) * 1000,
        ).toISOString(),
      ],
    );
  }
}
