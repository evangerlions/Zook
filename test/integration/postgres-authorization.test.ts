import assert from "node:assert/strict";
import test from "node:test";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";

const url = process.env.FROGSLEEP_TEST_DATABASE_URL;
if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
  || ["/postgres", "/template0", "/template1", "/"].includes(new URL(url).pathname)) {
  throw new Error("FROGSLEEP_TEST_DATABASE_URL must identify a dedicated local test database.");
}

test("extracted authorization queries preserve app isolation, upserts and transaction rollback", async suite => {
  const seed = buildDefaultSeed();
  const db = await PostgresDatabase.create(url, seed);
  const observer = await PostgresDatabase.create(url, seed);
  try {
    const permission = seed.permissions[0]!;
    await suite.test("roles are scoped to app and role permissions are deduplicated", async () => {
      await db.insertRoles([
        { id: "quality_role_a", appId: "app_a", code: "quality", name: "Quality A", status: "ACTIVE" },
        { id: "quality_role_b", appId: "app_b", code: "quality", name: "Quality B", status: "ACTIVE" },
      ]);
      await db.insertRoles([{ id: "quality_role_a", appId: "app_a", code: "quality", name: "Updated", status: "ACTIVE" }]);
      assert.equal((await observer.findRole("app_a", "quality"))?.name, "Updated");
      assert.equal((await observer.findRole("app_b", "quality"))?.id, "quality_role_b");
      assert.equal((await db.listRoles("app_a")).some(x => x.id === "quality_role_b"), false);
      await db.insertRolePermissions([{ id: "quality_permission", roleId: "quality_role_a", permissionId: permission.id }]);
      await db.insertRolePermissions([{ id: "quality_permission", roleId: "quality_role_a", permissionId: permission.id }]);
      await db.insertUserRole({ id: "quality_user_role", appId: "app_a", userId: "user_bob", roleId: "quality_role_a" });
      await db.insertUserRole({ id: "quality_user_role", appId: "app_a", userId: "user_bob", roleId: "quality_role_a" });
      assert.equal((await observer.findUserRole("app_a", "user_bob", "quality_role_a"))?.id, "quality_user_role");
      assert.equal(await observer.findUserRole("app_b", "user_bob", "quality_role_a"), undefined);
      assert.deepEqual(await observer.getPermissionCodes("app_a", "user_bob"), [permission.code]);
      assert.deepEqual(await observer.getPermissionCodes("app_b", "user_bob"), []);
      assert.ok((await observer.listPermissions()).some(x => x.id === permission.id));
    });
    await suite.test("delegated queries use the active transaction and never leak a rolled-back grant", async () => {
      await assert.rejects(db.withExclusiveSession(async () => {
        await db.insertRoles([{ id: "quality_rollback", appId: "app_b", code: "rollback", name: "Rollback", status: "ACTIVE" }]);
        await db.insertRolePermissions([{ id: "quality_rollback_permission", roleId: "quality_rollback", permissionId: permission.id }]);
        await db.insertUserRole({ id: "quality_rollback_member", appId: "app_b", userId: "user_bob", roleId: "quality_rollback" });
        assert.equal((await db.findRole("app_b", "rollback"))?.id, "quality_rollback");
        assert.deepEqual(await db.getPermissionCodes("app_b", "user_bob"), [permission.code]);
        assert.equal(await observer.findRole("app_b", "rollback"), undefined);
        throw new Error("rollback authorization grant");
      }), /rollback authorization grant/);
      assert.equal(await db.findRole("app_b", "rollback"), undefined);
      assert.equal(await observer.findUserRole("app_b", "user_bob", "quality_rollback"), undefined);
      assert.deepEqual(await observer.getPermissionCodes("app_b", "user_bob"), []);
    });
    await suite.test("global identity normalization and credential updates share transaction rollback", async () => {
      const identity = { ...seed.users[0]!, id: "quality_identity", email: "Quality.Mixed@example.com", phone: "+8613000000099" };
      await db.insertUser(identity);
      assert.equal((await observer.findUserByAccount(" QUALITY.MIXED@EXAMPLE.COM "))?.id, identity.id);
      assert.equal((await observer.findUserByPhone(" +8613000000099 "))?.id, identity.id);
      await assert.rejects(db.withExclusiveSession(async () => {
        await db.updateUserEmail(identity.id, "temporary@example.com");
        await db.updateUserPassword(identity.id, "test-only-temporary-hash", identity.passwordAlgo);
        assert.equal((await db.findUserById(identity.id))?.email, "temporary@example.com");
        assert.equal((await observer.findUserById(identity.id))?.email, identity.email);
        throw new Error("rollback identity update");
      }), /rollback identity update/);
      assert.equal((await db.findUserById(identity.id))?.email, identity.email);
      assert.equal((await observer.findUserById(identity.id))?.passwordHash, identity.passwordHash);
    });
  } finally { await observer.close(); await db.close(); }
});
