import assert from "node:assert/strict";
import test from "node:test";
import { PostgresBodyLogAdminStore } from "../../src/infrastructure/database/postgres/postgres-bodylog-admin.ts";

test("BodyLog admin dashboard calculates weighted check-in rates for day, week, and month", async () => {
  const statements: string[] = [];
  const store = new PostgresBodyLogAdminStore(async (sql) => {
    statements.push(sql);
    if (sql.includes("COUNT(DISTINCT g.id) as total_groups")) {
      return { rows: [{ total_groups: 2, total_members: 5, active_groups: 1 }] };
    }
    if (sql.includes("as daily") && sql.includes("as weekly") && sql.includes("as monthly")) {
      return { rows: [{ daily: "50.00", weekly: "60.00", monthly: "70.00" }] };
    }
    if (sql.includes("as dau") && sql.includes("as total_checkins")) {
      return { rows: [{ dau: 2, total_checkins: 4 }] };
    }
    return { rows: [] };
  });

  const result = await store.getBodyLogCheckinDashboard({
    appId: "bodylog", fromDate: "2026-09-01", toDate: "2026-09-24", timezone: "Asia/Shanghai",
  });

  assert.equal(result.summary.checkin_rate_daily, 50);
  assert.equal(result.summary.checkin_rate_weekly, 60);
  assert.equal(result.summary.checkin_rate_monthly, 70);
  assert.match(statements[1] ?? "", /SUM\(CASE WHEN r\.date = \$2::date THEN r\.completed_count/);
  assert.match(statements[1] ?? "", /NULLIF\(SUM\(CASE WHEN r\.date > \$2::date - INTERVAL '7 days'/);
});

test("BodyLog admin member contributions include app-scoped profile fields", async () => {
  let statement = "";
  const store = new PostgresBodyLogAdminStore(async (sql) => {
    statement = sql;
    return { rows: [{
      user_id: "user-1", role: "member", status: "active", nickname: "Mina",
      avatar_key: "leaf", checkin_count: "3", last_checkin_at: "2026-09-23T12:00:00.000Z",
    }] };
  });

  const [member] = await store.listBodyLogGroupMemberContributions({
    groupId: "group-1", fromDate: "2026-09-01", toDate: "2026-09-24",
  });

  assert.match(statement, /LEFT JOIN zook_bodylog_profiles p ON p\.app_id = g\.app_id AND p\.user_id = gm\.user_id/);
  assert.equal(member?.nickname, "Mina");
  assert.equal(member?.avatarKey, "leaf");
  assert.equal(member?.checkinCount, 3);
});
