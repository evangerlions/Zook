import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { PostgresDatabase } from '../../src/infrastructure/database/postgres/postgres-database.ts';
import { buildDefaultSeed } from '../../src/infrastructure/database/prisma/default-seed.ts';
import { DevelopmentPasswordHasher } from '../../src/modules/auth/password-hasher.ts';
import { AuthIdentityDirectory } from '../../src/modules/auth/identity/auth-identity-directory.ts';

const url = process.env.IDENTITY_TEST_DATABASE_URL;
if (!url) throw new Error('IDENTITY_TEST_DATABASE_URL must point to a disposable database');
test('PostgreSQL migration preserves legacy memberships and serializes identity ownership', async () => {
  const seed = buildDefaultSeed(new DevelopmentPasswordHasher());
  const first = await PostgresDatabase.create(url!, seed);
  const second = await PostgresDatabase.create(url!, seed);
  const sql = new Client({ connectionString: url });
  await sql.connect();
  try {
    // Re-run migration against a legacy snapshot including a deleted membership.
    await sql.query(`INSERT INTO zook_app_users(id,app_id,user_id,status,joined_at) VALUES
      ('identity-alice','ai_novel','user_alice','ACTIVE',NOW()),('identity-bob','ai_novel','user_bob','DELETED',NOW())
      ON CONFLICT(app_id,user_id) DO UPDATE SET status=EXCLUDED.status`);
    await sql.query('DROP TABLE zook_auth_identity_changes,zook_app_auth_identities,zook_app_auth_accounts');
    const migration = await readFile(new URL('../../src/infrastructure/database/postgres/migrations/106_app_auth_identities.sql', import.meta.url), 'utf8');
    await sql.query(migration);
    const directory = new AuthIdentityDirectory(first);
    assert.equal((await directory.find('ai_novel','email','alice@example.com'))?.id, 'user_alice');
    assert.equal((await directory.find('ai_novel','email','bob@example.com'))?.id, 'user_bob');
    assert.equal((await first.findAppUser('ai_novel','user_bob'))?.status, 'DELETED');
    await first.updateAppUserStatus('ai_novel','user_bob','ACTIVE');
    const services = [directory,new AuthIdentityDirectory(second)];
    const race = await Promise.allSettled(services.map((s,i) => s.bind('ai_novel',i ? 'user_bob':'user_alice','phone','+8613800000019')));
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(race.filter(r => r.status === 'rejected' && r.reason.code === 'AUTH_IDENTITY_ALREADY_BOUND').length, 1);
    await sql.query("UPDATE zook_users SET email='changed-elsewhere@example.com' WHERE id='user_alice'");
    await sql.query(migration);
    assert.equal(await first.authIdentityStore.findBinding('ai_novel','email','changed-elsewhere@example.com'),undefined);
    assert.equal((await directory.find('ai_novel','email','alice@example.com'))?.id,'user_alice');
    const owner = (await first.authIdentityStore.findBinding('ai_novel','phone','+8613800000019'))!.userId;
    assert.equal((await first.findUserById(owner))?.phone, undefined);
    await first.authIdentityStore.saveChange({id:'pg-pending',appId:'ai_novel',userId:owner,kind:'phone',mode:'replace',revision:1,
      currentVerified:false,status:'pending',expiresAt:new Date(Date.now()+60000).toISOString()});
    await first.deleteApp('ai_novel');
    assert.equal((await sql.query(`SELECT count(*)::int AS n FROM zook_app_auth_identities WHERE app_id='ai_novel'`)).rows[0].n,0);
    assert.equal(await first.authIdentityStore.getChange('pg-pending'),undefined);
  } finally { await sql.end(); await first.close(); await second.close(); }
});
