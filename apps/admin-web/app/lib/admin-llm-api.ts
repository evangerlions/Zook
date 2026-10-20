import type {
  AdminLlmMetricsDocument,
  AdminLlmModelMetricsDocument,
  AdminLlmRouteCircuitResetDocument,
  AdminLlmRouteCircuitResetRequest,
  AdminLlmServiceDocument,
  AdminLlmSmokeTestDocument,
  AdminLlmSmokeTestRunRequest,
  LlmMetricsRange,
} from "./types";
import { adminPath, requestJson } from "./admin-api-client.ts";
import { cleanQuery } from './admin-api-query.ts';
export const adminLlmApi={

  getLlmService() {
    return requestJson<AdminLlmServiceDocument>(adminPath("/apps/common/llm-service"));
  },

  getLlmServiceRevision(revision: number) {
    return requestJson<AdminLlmServiceDocument>(adminPath(`/apps/common/llm-service/revisions/${revision}`));
  },

  updateLlmService(input: Record<string, unknown>) {
    return requestJson<AdminLlmServiceDocument>(adminPath("/apps/common/llm-service"), {
      method: "PUT",
      body: input,
    });
  },

  restoreLlmService(revision: number, desc?: string) {
    return requestJson<AdminLlmServiceDocument>(
      adminPath(`/apps/common/llm-service/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },

  getLlmMetrics(range: LlmMetricsRange, filters: { provider?: string; providerModel?: string; operation?: "chat" | "embedding" } = {}) {
    const query = new URLSearchParams(cleanQuery({ range, ...filters }));
    return requestJson<AdminLlmMetricsDocument>(adminPath(`/apps/common/llm-service/metrics?${query.toString()}`));
  },

  resetLlmRouteCircuit(input: AdminLlmRouteCircuitResetRequest) {
    return requestJson<AdminLlmRouteCircuitResetDocument>(
      adminPath("/apps/common/llm-service/circuits/reset"),
      { method: "POST", body: input },
    );
  },

  getLlmModelMetrics(modelKey: string, range: LlmMetricsRange, provider?: string) {
    const query = new URLSearchParams(cleanQuery({ range, provider }));
    return requestJson<AdminLlmModelMetricsDocument>(
      adminPath(`/apps/common/llm-service/metrics/models/${encodeURIComponent(modelKey)}?${query.toString()}`),
    );
  },

  runLlmSmokeTest(input: AdminLlmSmokeTestRunRequest) {
    return requestJson<AdminLlmSmokeTestDocument>(adminPath("/apps/common/llm-service/smoke-test"), {
      method: "POST",
      body: input,
    });
  }
};
