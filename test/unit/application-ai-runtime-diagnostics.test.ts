import assert from "node:assert/strict";
import test from "node:test";

import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { createApplicationAiRuntime } from "../../src/application-ai-runtime.ts";
import { ALIYUN_TOKEN_PLAN_PROVIDER_KEY } from "../../src/services/aliyun-token-plan-provider.ts";
import { VOLCENGINE_AGENT_PLAN_PROVIDER_KEY } from "../../src/services/volcengine-agent-plan-provider.ts";
import { shouldUseLocalAiNovelE2eProvider } from "../../src/services/local-ainovel-e2e-provider.ts";

test("application runtime injects upstream diagnostics into Token Plan and Volcengine chat providers", (t) => {
  if (shouldUseLocalAiNovelE2eProvider()) {
    t.skip("local AI E2E provider replaces configured providers in this runtime");
    return;
  }

  const runtime = createApplicationAiRuntime({
    database: {} as never,
    commonLlmConfigService: {} as never,
    commonPasswordConfigService: {} as never,
    llmHealthService: {} as never,
    llmMetricsService: {} as never,
    kvManager: {} as never,
    llmRouteCircuitBreaker: {} as never,
    logger: new StructuredLogger("api", { emitToConsole: false }),
  });
  const providers = (
    runtime.llmManager as unknown as {
      providers: Record<string, { diagnostics?: unknown }>;
    }
  ).providers;

  const tokenPlanDiagnostics = providers[ALIYUN_TOKEN_PLAN_PROVIDER_KEY]?.diagnostics;
  const volcengineDiagnostics = providers[VOLCENGINE_AGENT_PLAN_PROVIDER_KEY]?.diagnostics;
  assert.ok(tokenPlanDiagnostics);
  assert.strictEqual(volcengineDiagnostics, tokenPlanDiagnostics);
});
