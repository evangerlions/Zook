import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";

import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";

const databaseUrl = process.env.FROGSLEEP_TEST_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("FROGSLEEP_TEST_DATABASE_URL is required and must point to a disposable PostgreSQL database.");
}

const migrationUrl = new URL(
  "../../src/infrastructure/database/postgres/migrations/019_frogsleep_buddy_group_pre_embedding.sql",
  import.meta.url,
);

async function applyMigration(client: Client, sql: string) {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

test("group pre-embedding upgrades legacy invitations and remains idempotent", async () => {
  await runPostgresMigrations({ connectionString: databaseUrl, log: () => undefined });
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`INSERT INTO zook_apps (id,code,name,status,join_mode)
      VALUES ('frogsleep','frogsleep','FrogSleep','ACTIVE','OPEN') ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO zook_users (id,email,password_hash,password_algo,status)
      VALUES ('migration_alice','migration_alice@example.com','test','test','ACTIVE')
      ON CONFLICT (id) DO NOTHING`);
    await client.query(`ALTER TABLE zook_frogsleep_buddy_invitation_bundles
      DROP CONSTRAINT IF EXISTS frogsleep_buddy_invitation_bundles_check_individual_or_group`);
    await client.query(`ALTER TABLE zook_frogsleep_buddy_sharing_grants
      ALTER COLUMN grantee_user_id SET NOT NULL`);
    for (const [id, email] of [["migration_email_invite", "recipient@example.com"],
      ["migration_open_invite", null]] as const) {
      await client.query(`INSERT INTO zook_frogsleep_buddy_invitation_bundles
        (id,app_id,inviter_user_id,invitee_user_id,recipient_email,share_code,handoff_token,
         share_link,locale,status,domains,version,expires_at)
        VALUES ($1,'frogsleep','migration_alice',NULL,$2,$3,$4,$5,'zh-CN','pending','{sleep}',1,
          NOW() + INTERVAL '1 day')`, [id, email, id.slice(-8).toUpperCase(), `${id}_token`,
        `https://app.youwoai.net/frogsleep/buddy-invitation?token=${id}_token`]);
    }

    const migration = await readFile(migrationUrl, "utf8");
    await applyMigration(client, migration);
    await client.query(`INSERT INTO zook_frogsleep_buddy_domain_relationships
      (id,app_id,domain,user_id_low,user_id_high,status,member_count,is_group,group_id)
      VALUES ('migration_group','frogsleep','sleep',NULL,NULL,'active',1,TRUE,'migration_group')`);
    await applyMigration(client, migration);

    const invitations = await client.query(`SELECT id FROM zook_frogsleep_buddy_invitation_bundles
      WHERE id IN ('migration_email_invite','migration_open_invite') ORDER BY id`);
    assert.deepEqual(invitations.rows.map((row) => row.id), ["migration_email_invite", "migration_open_invite"]);
    await client.query(`INSERT INTO zook_frogsleep_buddy_sharing_grants
      (id,app_id,relationship_id,grantor_user_id,grantee_user_id,is_group_grant,grantee_group_id,
       domain,category,state,version)
      VALUES ('migration_group_grant','frogsleep','migration_group','migration_alice',NULL,TRUE,
        'migration_group','sleep','presence','granted',1)`);
    await assert.rejects(client.query(`INSERT INTO zook_frogsleep_buddy_sharing_grants
      (id,app_id,relationship_id,grantor_user_id,grantee_user_id,is_group_grant,grantee_group_id,
       domain,category,state,version)
      VALUES ('migration_group_grant_duplicate','frogsleep','migration_group','migration_alice',NULL,TRUE,
        'migration_group','sleep','presence','granted',1)`), (error: any) => error?.code === "23505");
  } finally {
    await client.end();
  }
});
