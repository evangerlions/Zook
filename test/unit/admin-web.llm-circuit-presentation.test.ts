import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { circuitRecoveryLabel } from "../../apps/admin-web/app/components/llm-monitor/circuit-recovery-presentation.ts";
import type { LlmRouteCircuitRuntimeStatus } from "../../apps/admin-web/app/lib/types/llm.ts";

const base: LlmRouteCircuitRuntimeStatus = {
  enabled: true, state: "open", failureCount: 1, distinctUserCount: 1,
  recoverySuccessCount: 0, recoveryFailureCount: 0,
};

test("circuit presentation preserves automatic recovery and manual reset", () => {
  assert.equal(circuitRecoveryLabel(base), "失败 1 · 用户 1 · 探测 0/2");
  assert.equal(circuitRecoveryLabel({ ...base, state: "confirming" }), "后台确认中");
  assert.equal(circuitRecoveryLabel({ ...base, state: "closed" }), "正常");
  assert.equal(circuitRecoveryLabel(undefined), "未启用");
  const view = readFileSync(new URL("../../apps/admin-web/app/components/llm-monitor/routing-section.tsx", import.meta.url), "utf8");
  assert.match(view, /circuitRecoveryLabel\(row.circuit\)/);
  assert.match(view, /row.circuit\?\.state === "open" \|\| row.circuit\?\.state === "confirming"/);
});
