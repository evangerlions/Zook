import { resolveMaterials } from "../materials/material.validation.ts";
import { InvestmentService } from "../investment.service.ts";
import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import type { JobQueue } from "../../../../infrastructure/queue/job-queue.ts";
import { captureModel } from "../../personal-model/personal-model.service.ts";
import {
  digest,
  keys,
  integer,
  fail,
} from "../../learning/native-learning.validation.ts";
import { researchId } from "../research/research.validation.ts";
import {
  RESEARCH_AI_SCENE,
  publicWork,
  type ResearchAIWork,
} from "./research-ai.types.ts";
export const RESEARCH_AI_JOB = "lighttick.research.ai";
export class ResearchAIService extends InvestmentService {
  constructor(
    repo: LightTickRepository,
    readonly queue: JobQueue,
    authorize = async () => {},
    clock = () => new Date(),
  ) {
    super(repo, authorize, clock);
  }
  async current(o: LightTickOwner, w: ResearchAIWork) {
    const r = await this.repo.investments.research.get(o, w.input.research.id),
      i = await this.repo.investments.instrument(
        o,
        w.input.research.instrument_id,
      );
    if (
      !r ||
      r.archived ||
      r.revision !== w.input.research.revision ||
      !i ||
      i.archived ||
      i.revision !== w.input.instrument.revision
    )
      fail(409, "Research input changed; review a new task.");
    if (r.account_id) {
      const a = await this.repo.investments.account(o, r.account_id);
      if (!a || a.archived) fail(409, "Research account unavailable");
    }
    if (w.input.materials?.length)
      await resolveMaterials(
        this.repo,
        o,
        w.input.research.material_sources ?? [],
      );
    const model = await captureModel(this.repo, o);
    if (
      model.mode !== w.input.model.mode ||
      model.revision !== w.input.model.revision
    )
      fail(409, "Model selection changed");
  }
  async create(o: LightTickOwner, b: Record<string, unknown>, key: string) {
    keys(b, [
      "research_id",
      "base_revision",
      "kind",
      "consent",
      "model_mode",
      "model_revision",
    ]);
    researchId(b.research_id);
    const base = integer(b.base_revision, 1, 99);
    if (
      !["analysis", "guide", "report"].includes(String(b.kind)) ||
      b.consent !== true
    )
      fail(422, "Explicit reviewed source/model consent required");
    const id = "researchai-" + digest([o, key]).slice(0, 40);
    await this.command(o, key, "research_ai", id, "create", b, async (now) => {
      const research = await this.repo.investments.research.get(
        o,
        String(b.research_id),
      );
      if (!research || research.archived || research.revision !== base)
        fail(409, "Research changed");
      const all = await this.repo.researchAI.list(o);
      if (
        all.length >= 200 ||
        all.filter((w) => w.created_at.slice(0, 10) === now.slice(0, 10))
          .length >= 8 ||
        all.some((w) => ["queued", "running"].includes(w.status))
      )
        fail(429, "Research AI capacity or daily budget exhausted");
      const markets = [];
      for (const ref of research.market_sources) {
        const m = await this.repo.investments.market.snapshot(o, ref.id);
        if (
          !m ||
          m.revision !== ref.version ||
          m.dataset.input_digest !== ref.input_digest ||
          m.instrument_id !== research.instrument_id
        )
          fail(409, "Market source unavailable");
        markets.push(m);
      }
      const model = await captureModel(this.repo, o);
      if (model.mode !== b.model_mode || model.revision !== b.model_revision)
        fail(409, "Reviewed model selection changed");
      const instrument = await this.repo.investments.instrument(
        o,
        research.instrument_id,
      );
      if (!instrument || instrument.archived)
        fail(409, "Instrument unavailable");
      const materials = await resolveMaterials(
        this.repo,
        o,
        research.material_sources ?? [],
      );
      const frozen = {
        scene: RESEARCH_AI_SCENE,
        instrument,
        research,
        markets,
        model,
        ...(materials.length ? { materials } : {}),
      };
      if (Buffer.byteLength(JSON.stringify(frozen)) > 18000)
        fail(
          413,
          "Reviewed sources exceed scene budget; use a smaller research entry",
        );
      const w: ResearchAIWork = {
        ...o,
        id,
        revision: 1,
        kind: b.kind as ResearchAIWork["kind"],
        request_key: key,
        input: { ...frozen, digest: digest(frozen) },
        status: "queued",
        attempt: 0,
        fence: null,
        lease_until: null,
        error_code: null,
        output: null,
        adopted_at: null,
        created_at: now,
        updated_at: now,
      };
      await this.current(o, w);
      await this.repo.researchAI.save(w, 0);
      return publicWork(w);
    });
    await this.dispatch(o, id);
    return this.readWork(o, id);
  }
  async readWork(o: LightTickOwner, id: string) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const w = await this.repo.researchAI.get(o, id);
      if (!w) fail(404, "Research AI task not found");
      return publicWork(w);
    });
  }
  async listWorks(
    o: LightTickOwner,
    research: string,
    cursor = "",
    limit = 20,
  ) {
    researchId(research);
    integer(limit, 1, 50);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const all = (await this.repo.researchAI.list(o))
          .filter((w) => w.input.research.id === research)
          .sort((a, b) =>
            a.created_at === b.created_at
              ? a.id < b.id
                ? 1
                : -1
              : a.created_at < b.created_at
                ? 1
                : -1,
          ),
        revision = digest(all);
      let after = "";
      if (cursor) {
        if (cursor.length > 2048) fail(409, "Cursor too long");
        try {
          const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
          if (
            c.scope !== digest([o, research]) ||
            c.revision !== revision ||
            typeof c.after !== "string"
          )
            throw Error();
          after = c.after;
        } catch {
          fail(409, "Rebuild task list; retain drafts");
        }
      }
      const index = after ? all.findIndex((w) => w.id === after) : -1;
      if (after && index < 0) fail(409, "Cursor position changed");
      const rows = all.slice(index + 1);
      return {
        items: rows.slice(0, limit).map(publicWork),
        next_cursor:
          rows.length > limit
            ? Buffer.from(
                JSON.stringify({
                  scope: digest([o, research]),
                  revision,
                  after: rows[limit - 1].id,
                }),
              ).toString("base64url")
            : null,
      };
    });
  }
  async mutate(
    o: LightTickOwner,
    id: string,
    action: "cancel" | "adopt",
    b: Record<string, unknown>,
    key: string,
  ) {
    keys(b, ["base_revision"]);
    const base = integer(b.base_revision, 1, 2147483646);
    return this.command(o, key, "research_ai", id, action, b, async (now) => {
      const w = await this.repo.researchAI.get(o, id);
      if (!w) fail(404, "Task not found");
      if (w.revision !== base) fail(409, "Task revision changed");
      if (
        (action === "cancel" && !["queued", "running"].includes(w.status)) ||
        (action === "adopt" &&
          (w.status !== "succeeded" || w.adopted_at || !w.output))
      )
        fail(409, "Task cannot perform this transition");
      if (action === "adopt") await this.current(o, w);
      const next = {
        ...w,
        revision: base + 1,
        status: action === "cancel" ? ("cancelled" as const) : w.status,
        fence: null,
        lease_until: null,
        adopted_at: action === "adopt" ? now : null,
        updated_at: now,
      };
      await this.repo.researchAI.save(next, base);
      return publicWork(next);
    });
  }
  async dispatch(o: LightTickOwner, id: string) {
    const w = await this.repo.researchAI.get(o, id);
    if (!w || !["queued", "running"].includes(w.status)) return;
    try {
      await this.queue.add(
        RESEARCH_AI_JOB,
        { app_id: o.appId, user_id: o.userId, work_id: id },
        {
          jobId: "researchai-" + digest([o, id, w.attempt]).slice(0, 40),
          attempts: 1,
        },
      );
    } catch {
      /* persistent work recovery */
    }
  }
}
