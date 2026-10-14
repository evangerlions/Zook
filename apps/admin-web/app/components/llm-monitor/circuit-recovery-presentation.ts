import type { LlmRouteCircuitRuntimeStatus } from "../../lib/types/llm.ts";

export function circuitRecoveryLabel(circuit?: LlmRouteCircuitRuntimeStatus): string {
  if (!circuit?.enabled) return "未启用";
  if (circuit.state === "confirming") return "后台确认中";
  if (circuit.state !== "open") return "正常";
  return `失败 ${circuit.failureCount} · 用户 ${circuit.distinctUserCount} · 探测 ${circuit.recoverySuccessCount}/2`;
}
