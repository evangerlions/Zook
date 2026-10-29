import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";

enableFrogSleepBuddyCapabilities();
const root = fileURLToPath(new URL("../../api-contracts/", import.meta.url));
const parsed = spawnSync("python3", ["-c", `
import json, pathlib, sys, yaml
r=pathlib.Path(sys.argv[1])
docs={str(p.relative_to(r)):yaml.safe_load(p.read_text()) for p in (r/'openapi').rglob('*.yaml')}
json.dump({'docs':docs,'config':yaml.safe_load((r/'redocly.yaml').read_text()),
 'ignore':yaml.safe_load((r/'.redocly.lint-ignore.yaml').read_text()),
 'ledger':json.loads((r/'lint-exceptions.json').read_text())},sys.stdout)
`, root], { encoding: "utf8" });
assert.equal(parsed.status, 0, parsed.stderr);
const { docs, config, ignore, ledger } = JSON.parse(parsed.stdout);
function pointer(doc: any, value: string) {
  return value.slice(2).split("/").map(x => x.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((node, key) => node?.[key], doc);
}
function validator(file: string, path: string, method: string, status = "200") {
  const doc = docs[`openapi/${file}`];
  let response = doc.paths[path][method].responses[status];
  if (response.$ref) response = pointer(doc, response.$ref);
  const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
  return ajv.compile({ components: doc.components, ...response.content["application/json"].schema });
}
function check(validate: ReturnType<typeof validator>, value: unknown) {
  assert.equal(validate(JSON.parse(JSON.stringify(value))), true, JSON.stringify(validate.errors));
}

test("lint retains recommended rules and only exact, documented semantic exceptions", () => {
  assert.deepEqual(config.extends, ["recommended"]);
  assert.equal(config.rules, undefined);
  const actual: string[] = [];
  for (const [file, rules] of Object.entries(ignore) as any) {
    for (const [rule, pointers] of Object.entries(rules) as any) {
      for (const p of pointers) {
        assert.notEqual(pointer(docs[file], p), undefined, `${file} ${p}`);
        assert.ok(p.startsWith("#/paths/") || p.startsWith("#/components/"));
        actual.push(JSON.stringify([file, rule, p]));
      }
    }
  }
  assert.equal(new Set(actual).size, actual.length);
  assert.deepEqual(actual.sort(), ledger.map((x: any) => {
    assert.ok(x.reason.length > 80);
    return JSON.stringify([x.source, x.rule, x.pointer]);
  }).sort());
  assert.equal(actual.length, 16);
  const ai = docs["openapi/ainovel/ai.yaml"];
  const referenced = Object.values(ai.paths).flatMap((p: any) => Object.entries(p.post ?? {})
    .filter(([key]) => key.startsWith("x-decrypted-")).map(([, value]: any) => value.$ref));
  for (const e of ledger.filter((x: any) => x.source.endsWith("ainovel/ai.yaml"))) assert.ok(referenced.includes(e.pointer));
});

test("health and preview redirects keep their real status contracts without fabricated success responses", async () => {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory" });
  try {
    const health = await app.app.handle({ method: "GET", path: "/api/health", headers: {} });
    assert.equal(health.statusCode, 200);
    for (const path of ["/frogsleep/sleep-buddy-invite", "/frogsleep/focus-invite"]) {
      const response = await app.app.handle({ method: "GET", path, headers: {}, query: {} });
      assert.equal(response.statusCode, 302);
      assert.ok(response.headers?.Location?.includes("mode=preview") || response.headers?.location?.includes("mode=preview"));
      assert.deepEqual(Object.keys(docs["openapi/frogsleep/api.yaml"].paths[path].get.responses), ["302"]);
    }
    const legacy = docs["openapi/bodylog/api.yaml"].paths["/api/v1/bodylog/seven-day-plan/{planId}/missions/{missionId}/complete"].post;
    assert.deepEqual(Object.keys(legacy.responses).sort(), ["404", "409"]);
    assert.match(legacy.description, /BODYLOG_GROWTH_LOCAL_EVIDENCE_REQUIRED/);
  } finally { await app.close(); }
});

test("FrogSleep documented state, entitlement and invitation responses match live route envelopes", async () => {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory" });
  try {
    const session = await app.services.authService.login({ appId: "frogsleep", account: "alice@example.com", password: "Password1234" });
    const headers = { authorization: `Bearer ${session.accessToken}` };
    const call = (path: string, method = "GET", body?: unknown) => app.app.handle({ method, path, body, headers } as never);
    for (const path of ["/api/v1/frogsleep/product-data/personal-sync/state", "/api/v1/frogsleep/product-data/entitlements/current"]) {
      const result = await call(path); assert.equal(result.statusCode, 200);
      check(validator("frogsleep/api.yaml", path, "get"), result.body);
    }
    const created = await call("/api/v1/frogsleep/buddy/invitations", "POST", { target: { email: "bob@example.com" }, domains: ["sleep"] });
    assert.equal(created.statusCode, 200, JSON.stringify(created.body));
    const id = (created.body.data as any).invitation_id;
    for (const [path, template] of [
      ["/api/v1/frogsleep/buddy/invitations", "/api/v1/frogsleep/buddy/invitations"],
      [`/api/v1/frogsleep/buddy/invitations/${id}`, "/api/v1/frogsleep/buddy/invitations/{inviteId}"],
      [`/api/v1/frogsleep/buddy/invitations/${id}/delivery`, "/api/v1/frogsleep/buddy/invitations/{inviteId}/delivery"],
    ]) {
      const result = await call(path); assert.equal(result.statusCode, 200, JSON.stringify(result.body));
      check(validator("frogsleep/api.yaml", template!, "get"), result.body);
    }
  } finally { await app.close(); }
});

test("coach conditional message validation and notification compatibility remain intact", () => {
  const ajv = new Ajv2020({ strict: false });
  const light = docs["openapi/lighttick/api.yaml"];
  const coach = ajv.compile({ components: light.components, ...light.components.schemas.LightTickCoachRunRequest });
  assert.equal(coach({ scene: "chat", goal_id: "goal_quality_1" }), false);
  assert.equal(coach({ scene: "chat", goal_id: "goal_quality_1", message: "" }), false);
  assert.equal(coach({ scene: "chat", goal_id: "goal_quality_1", message: "Help" }), true);
  assert.equal(coach({ scene: "recovery", goal_id: "goal_quality_1" }), true);
  const frog = docs["openapi/frogsleep/api.yaml"];
  const kind = new Ajv2020({ strict: false }).compile({ components: frog.components, ...frog.components.schemas.FrogSleepBuddyNotification.properties.type });
  for (const value of ["invitation_created", "invitation_declined", "future_notification"]) assert.equal(kind(value), true);
});
