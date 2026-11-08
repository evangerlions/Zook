/** Strictly synthetic localhost snapshot/receipt capture across HTTP and PostgreSQL restarts. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
const mode = process.argv[2],
  path = process.argv[3],
  expected = process.argv[4],
  dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !["capture", "verify"].includes(mode) ||
  !path ||
  !expected ||
  !/^[a-f0-9]{40}$/.test(expected) ||
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  new URL(dsn).port !== "58641" ||
  !/^\/grow_web_u1_f[0-9a-f]+$/.test(new URL(dsn).pathname)
)
  throw Error("Explicit synthetic form-editor fixture required");
const root = "http://127.0.0.1:58642";
if (
  !(await (await fetch(root + "/grow/runtime-config.js")).text()).includes(
    expected,
  )
)
  throw Error("Unexpected served source");
const auth = await fetch(root + "/api/v1/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    appId: "lighttick",
    account: "alice@example.com",
    password: "Password1234",
    clientType: "app",
  }),
});
if (!auth.ok) throw Error("Synthetic login failed");
const token = ((await auth.json()) as any).data.accessToken;
async function request(route: string, body?: unknown, key?: string) {
  const r = await fetch(root + "/api/v1/lighttick/" + route, {
    method: body ? "PATCH" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      "X-App-Id": "lighttick",
      ...(body
        ? { "Content-Type": "application/json", "Idempotency-Key": key! }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw Error("Synthetic request failed: " + r.status);
  return ((await r.json()) as any).data;
}
const canonical = (v: any): string =>
  Array.isArray(v)
    ? "[" + v.map(canonical).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
          .join(",") +
        "}"
      : JSON.stringify(v);
const digest = (v: unknown) =>
  createHash("sha256").update(canonical(v)).digest("hex");
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool),
  o = { appId: "lighttick" as const, userId: "user_alice" };
try {
  const snapshot = await request("form-records");
  if (digest(await repo.formRecords.get(o)) !== digest(snapshot))
    throw Error("API and PG fixture disagree");
  const count = Number(
    (
      await pool.query(
        "SELECT count(*) FROM zook_lighttick_operations WHERE app_id='lighttick' AND user_id='user_alice' AND entity_type='form_records'",
      )
    ).rows[0].count,
  );
  const peerSnapshot =
    (await repo.formRecords.get({ ...o, userId: "user_bob" })) ?? null;
  if (mode === "capture") {
    const row = (
      await pool.query(
        "SELECT operation_id FROM zook_lighttick_operations WHERE app_id='lighttick' AND user_id='user_alice' AND entity_type='form_records' AND action='section:reviews' ORDER BY (result_payload->>'revision')::int DESC LIMIT 1",
      )
    ).rows[0];
    if (!row) throw Error("Run the form stories first");
    const op = (await repo.getOperation(o, row.operation_id))!;
    writeFileSync(
      path,
      JSON.stringify(
        {
          scope: "synthetic_form_editor_restart",
          web_revision: expected,
          snapshot_sha256: digest(snapshot),
          peer_snapshot_sha256: digest(peerSnapshot),
          snapshot_revision: snapshot.revision,
          operation_count: count,
          replay: {
            key: op.operationId,
            body: op.requestPayload,
            result_sha256: digest(op.resultPayload),
          },
        },
        null,
        2,
      ) + "\n",
    );
    console.log("Captured synthetic form snapshot and original receipt");
  } else {
    const before = JSON.parse(readFileSync(path, "utf8"));
    if (
      before.web_revision !== expected ||
      before.snapshot_sha256 !== digest(snapshot) ||
      before.peer_snapshot_sha256 !== digest(peerSnapshot) ||
      before.snapshot_revision !== snapshot.revision ||
      before.operation_count !== count
    )
      throw Error("Snapshot, revision or receipt count changed across restart");
    const replay = await request(
      "form-records/sections/reviews",
      before.replay.body,
      before.replay.key,
    );
    if (
      digest(replay) !== before.replay.result_sha256 ||
      digest(await request("form-records")) !== before.snapshot_sha256
    )
      throw Error("Original replay changed accepted facts");
    const afterCount = Number(
      (
        await pool.query(
          "SELECT count(*) FROM zook_lighttick_operations WHERE app_id='lighttick' AND user_id='user_alice' AND entity_type='form_records'",
        )
      ).rows[0].count,
    );
    if (afterCount !== count) throw Error("Replay duplicated a receipt");
    const result = {
      passed: true,
      web_revision: expected,
      snapshot_sha256: before.snapshot_sha256,
      snapshot_revision: snapshot.revision,
      final_peer_revision: peerSnapshot?.revision ?? null,
      original_receipts: count,
      http_and_postgres_restart_preserve_snapshot: true,
      old_original_replay_returns_old_result_without_overwriting_newer_facts: true,
    };
    writeFileSync(
      path.replace(/capture\.json$/, "result.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(JSON.stringify(result));
  }
} finally {
  await pool.end();
}
