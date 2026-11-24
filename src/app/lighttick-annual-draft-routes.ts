import { createLightTickAiRun } from "../modules/lighttick/ai/lighttick-ai-run-record.ts";
import { buildLightTickPublicConfiguration } from "../modules/lighttick/lighttick-public-config.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { annualDraftFlagsEnabled, annualDraftScene, assertAnnualDraftAvailable, loadAnnualDraftContext, readAnnualDraftRequest } from "../modules/lighttick/planning/annual-draft-context.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { bodyOf, idempotent, response } from "./lighttick-v1-http.ts";

const route = /^\/api\/v1\/lighttick\/planning-year\/draft(?:\/([A-Za-z0-9_-]{8,128}))?$/;

function runData(run: LightTickAiRunRow) {
  return { id: run.id, status: run.status,
    ...(run.errorCode ? { error_code: run.errorCode } : {}),
    ...(run.status === "succeeded" && run.output ? { output: run.output } : {}) };
}

export async function handleAnnualDraftRequest(context: BackendRouteContext, runtime: LightTickRuntime,
  owner: LightTickOwner, request: HttpRequest, assertActive: () => Promise<void>) {
  const match = route.exec(request.path);
  if (!match) return undefined;
  const expectedMethod = match[1] ? "GET" : "POST";
  if (request.method !== expectedMethod)
    throw new ApplicationError(405, "VALIDATION_ERROR", "Method is not supported.", undefined, { Allow: expectedMethod });

  const available = async () => !!runtime.jobs && annualDraftFlagsEnabled(
    buildLightTickPublicConfiguration(true, await runtime.scopePolicy.record(), undefined, runtime.planningEnabled).features);
  let runId = match[1];
  if (!runId) {
    const intent = readAnnualDraftRequest(bodyOf(request));
    const receipt = await idempotent(runtime, owner, request, annualDraftScene, String(intent.year), "generate", async () => {
      await assertActive();
      assertAnnualDraftAvailable(await available());
      const now = runtime.today.now();
      const { fingerprint } = await loadAnnualDraftContext(runtime.repository, owner, intent, now);
      const job = await createLightTickAiRun(runtime.repository, owner, annualDraftScene, annualDraftScene, undefined,
        { annual_draft: { request: intent, fingerprint } }, now.toISOString());
      return { id: job.id };
    });
    runId = receipt.id;
  }
  const run = await runtime.repository.getAiRun(owner, runId);
  if (run?.kind !== annualDraftScene)
    throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Annual draft run was not found.");
  if (request.method === "POST" && run.status === "queued" && await available())
    await runtime.jobs!.enqueueAiRun(owner, run.id, annualDraftScene);
  const result = response(context, request, runData(run), request.method === "POST" ? 202 : 200);
  return { ...result, headers: { ...result.headers, "Cache-Control": "no-store" } };
}
