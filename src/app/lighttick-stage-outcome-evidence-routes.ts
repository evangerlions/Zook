import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { readStageOutcomeEvidence, saveStageOutcomeEvidence } from "../modules/lighttick/planning/stage-outcome-evidence.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { bodyOf, idempotent, response } from "./lighttick-v1-http.ts";

export async function handleStageOutcomeEvidenceRequest(context: BackendRouteContext, runtime: LightTickRuntime, owner: LightTickOwner,
  request: HttpRequest, assertActive: () => Promise<void>) {
  const goalId = /^\/api\/v1\/lighttick\/goals\/([A-Za-z0-9][A-Za-z0-9_-]{7,127})\/outcome-evidence$/.exec(request.path)?.[1];
  if (!goalId) return undefined;
  const now = runtime.today.now();
  let data: unknown;
  if (request.method === "GET") {
    data = await readStageOutcomeEvidence(runtime.repository, owner, goalId, now, request.query ?? {});
  } else if (request.method === "POST") {
    data = await idempotent(runtime, owner, request, "goal", goalId, "stage_outcome_evidence", async () => {
      await assertActive();
      return saveStageOutcomeEvidence(runtime.repository, owner, goalId, now, bodyOf(request));
    });
  } else {
    throw new ApplicationError(405, "REQ_METHOD_NOT_ALLOWED", "Method is not supported.", undefined, { Allow: "GET, POST" });
  }
  const result = response(context, request, data);
  result.headers = { ...result.headers, "Cache-Control": "no-store" };
  return result;
}
