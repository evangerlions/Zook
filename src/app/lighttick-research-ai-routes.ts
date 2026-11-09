import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import { ResearchAIService } from "../modules/lighttick/investments/research-ai/research-ai.service.ts";
import {
  object,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handleResearchAI(
  runtime: { researchAI?: ResearchAIService },
  o: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const prefix = "/api/v1/lighttick/investments/research-ai";
  if (r.path !== prefix && !r.path.startsWith(prefix + "/")) return;
  const base = runtime.researchAI;
  if (!base) fail(503, "Research AI unavailable");
  const s = new ResearchAIService(base.repo, base.queue, authorize, base.clock),
    path = r.path.slice(prefix.length),
    key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
  if (!path && r.method === "POST") return s.create(o, object(r.body), key);
  if (!path && r.method === "GET")
    return s.listWorks(
      o,
      r.query?.research_id ?? "",
      r.query?.cursor ?? "",
      Number(r.query?.limit ?? 20),
    );
  const m = /^\/(researchai-[a-f0-9]{40})(?:\/(cancel|adopt))?$/.exec(path);
  if (!m) fail(404, "Research AI route not found");
  if (r.method === "GET" && !m[2]) return s.readWork(o, m[1]);
  if (r.method === "POST" && m[2])
    return s.mutate(o, m[1], m[2] as "cancel" | "adopt", object(r.body), key);
  fail(404, "Research AI route not found");
}
