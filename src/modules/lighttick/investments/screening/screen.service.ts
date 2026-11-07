import { ScreenDefinitions, page } from "./screen.definitions.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { JobQueue } from "../../../../infrastructure/queue/job-queue.ts";
import { investmentId } from "../investment.service.ts";
import {
  keys,
  object,
  integer,
  fail,
  digest,
} from "../../learning/native-learning.validation.ts";
import { marketDate, shanghaiClock } from "../market/market.validation.ts";
import { timestamp, securityStatus } from "./screen.validation.ts";
import {
  SCREEN_ALGORITHM,
  publicWork,
  type ScreenWork,
  type ScreenInput,
  type Definition,
} from "./screen.types.ts";
export const SCREEN_JOB = "lighttick.investment.screen";
export const SCREEN_LIMITS = {
  retained: 100,
  daily: 20,
  active: 1,
  input_bytes: 2 * 1024 * 1024,
  attempts: 3,
  lease_ms: 60000,
  timeout_ms: 30000,
};
export class ScreeningService extends ScreenDefinitions {
  constructor(
    repo: LightTickRepository,
    readonly queue: JobQueue,
    authorize = async () => {},
    clock = () => new Date(),
  ) {
    super(repo, authorize, clock);
  }
  async context(o: LightTickOwner, input: ScreenInput) {
    const t = await this.store.definition(o, "templates", input.template.id),
      r = await this.store.definition(o, "rules", input.rule.id);
    if (!t || t.archived || !(t.fields as any).enabled || !r || r.archived)
      fail(409, "Rule/template stopped or unavailable.");
    const aid = input.template.fields.account_id;
    if (aid) {
      const a = await this.repo.investments.account(o, aid);
      if (!a || a.archived) fail(409, "Template account unavailable.");
    }
    for (const s of input.sources) {
      const i = await this.repo.investments.instrument(o, s.instrument.id);
      if (!i || i.archived || i.revision !== s.instrument.revision)
        fail(409, "Frozen pool instrument changed.");
    }
  }
  async createRun(o: LightTickOwner, b: Record<string, unknown>, key: string) {
    keys(b, [
      "template_id",
      "base_revision",
      "as_of",
      "decision_at",
      "sources",
      "consent",
    ]);
    const tid = investmentId(b.template_id),
      base = integer(b.base_revision, 1, 100),
      as_of = marketDate(b.as_of),
      decision_at = timestamp(b.decision_at);
    if (
      b.consent !== true ||
      Date.parse(decision_at) > this.clock().getTime() ||
      as_of > shanghaiClock(new Date(decision_at)).slice(0, 10)
    )
      fail(422, "Review explicit sources and a nonfuture decision/data date.");
    if (
      !Array.isArray(b.sources) ||
      b.sources.length < 1 ||
      b.sources.length > 20
    )
      fail(422, "Explicit 1..20 pool sources required.");
    const selections = b.sources.map((v) => {
      const s = object(v);
      keys(s, [
        "instrument_id",
        "snapshot_id",
        "input_digest",
        "security_status",
      ]);
      const instrument_id = investmentId(s.instrument_id),
        snapshot_id =
          s.snapshot_id === null ? null : investmentId(s.snapshot_id);
      if (
        snapshot_id === null
          ? s.input_digest !== null
          : typeof s.input_digest !== "string" ||
            !/^[a-f0-9]{64}$/.test(s.input_digest)
      )
        fail(422, "Select exact snapshot/digest or explicit missing source.");
      return {
        instrument_id,
        snapshot_id,
        input_digest: s.input_digest,
        security_status: securityStatus(s.security_status, as_of, decision_at),
      };
    });
    if (
      new Set(selections.map((s) => s.instrument_id)).size !== selections.length
    )
      fail(422, "Duplicate source instrument.");
    const id = "inv-screen-" + digest([o, key]).slice(0, 40);
    await this.command(
      o,
      key,
      "investment_screen_run",
      id,
      "create",
      b,
      async (now) => {
        const t = (await this.store.definition(o, "templates", tid)) as
          | Definition<"templates">
          | undefined;
        if (!t || t.archived || !t.fields.enabled || t.revision !== base)
          fail(409, "Template changed or stopped.");
        const rule = await this.templateContext(o, t.fields);
        const works = await this.store.works(o);
        if (
          works.length >= SCREEN_LIMITS.retained ||
          works.filter((w) => w.created_at.slice(0, 10) === now.slice(0, 10))
            .length >= SCREEN_LIMITS.daily ||
          works.some((w) => ["queued", "running"].includes(w.status))
        )
          fail(429, "Screening capacity or budget exhausted.");
        if (
          selections.length !== t.fields.instrument_ids.length ||
          t.fields.instrument_ids.some(
            (id) => !selections.some((s) => s.instrument_id === id),
          )
        )
          fail(
            422,
            "Source selection must exactly match frozen template pool.",
          );
        const sources = [];
        for (const iid of t.fields.instrument_ids) {
          const selected = selections.find((s) => s.instrument_id === iid)!,
            instrument = (await this.repo.investments.instrument(o, iid))!;
          const snapshot = selected.snapshot_id
            ? await this.repo.investments.market.snapshot(
                o,
                selected.snapshot_id,
              )
            : null;
          if (
            selected.snapshot_id &&
            (!snapshot ||
              snapshot.revision !== 1 ||
              snapshot.instrument_id !== iid ||
              snapshot.dataset.input_digest !== selected.input_digest)
          )
            fail(404, "Exact owner/instrument snapshot unavailable.");
          if (
            snapshot &&
            (!Number.isFinite(Date.parse(snapshot.dataset.available_at)) ||
              Date.parse(snapshot.dataset.available_at) >
                Date.parse(decision_at))
          )
            fail(422, "Snapshot was not available at decision time.");
          sources.push({
            instrument,
            snapshot: snapshot ?? null,
            security_status: selected.security_status,
          });
        }
        const frozen = {
          template: t,
          rule,
          as_of,
          decision_at,
          sources,
          algorithm_version: SCREEN_ALGORITHM as typeof SCREEN_ALGORITHM,
        };
        if (
          Buffer.byteLength(JSON.stringify(frozen)) > SCREEN_LIMITS.input_bytes
        )
          fail(
            413,
            "Frozen input exceeds capacity; select a smaller pool/window.",
          );
        const input: ScreenInput = { ...frozen, digest: digest(frozen) };
        await this.context(o, input);
        const w: ScreenWork = {
          ...o,
          id,
          revision: 1,
          request_key: key,
          input,
          status: "queued",
          command_keys: [key],
          attempt: 0,
          fence: null,
          lease_until: null,
          error_code: null,
          output: null,
          created_at: now,
          updated_at: now,
        };
        await this.store.saveWork(w, 0);
        return { id };
      },
    );
    await this.dispatch(o, id);
    return this.readRun(o, id);
  }
  async readRun(o: LightTickOwner, id: string) {
    investmentId(id);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const w = await this.store.work(o, id);
      if (!w) fail(404, "Screen task not found.");
      return publicWork(w);
    });
  }
  async listRuns(
    o: LightTickOwner,
    cursor = "",
    limit = 20,
    template?: string,
  ) {
    integer(limit, 1, 50);
    if (template) investmentId(template);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const rows = await this.store.works(o);
      if (rows.length > 100) fail(413, "Run catalog exceeds capacity.");
      return page(
        rows.filter((w) => !template || w.template_id === template),
        [o, "screen_runs", template ?? null],
        cursor,
        limit,
        (w) => w.id,
      );
    });
  }
  async cancel(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    investmentId(id);
    keys(b, ["base_revision"]);
    const base = integer(b.base_revision, 1, 2147483646);
    return this.command(
      o,
      key,
      "investment_screen_run",
      id,
      "cancel",
      b,
      async (now) => {
        const w = await this.store.work(o, id);
        if (!w) fail(404, "Screen task not found.");
        if (w.revision !== base || !["queued", "running"].includes(w.status))
          fail(409, "Task revision or status changed.");
        const next = {
          ...w,
          revision: base + 1,
          status: "cancelled" as const,
          command_keys: [...w.command_keys, key],
          fence: null,
          lease_until: null,
          updated_at: now,
        };
        await this.store.saveWork(next, base);
        return publicWork(next);
      },
    );
  }
  async dispatch(o: LightTickOwner, id: string) {
    const w = await this.store.work(o, id);
    if (!w || !["queued", "running"].includes(w.status)) return;
    try {
      await this.queue.add(
        SCREEN_JOB,
        { app_id: o.appId, user_id: o.userId, work_id: id },
        {
          jobId: "screen-" + digest([o, id, w.attempt]).slice(0, 40),
          attempts: 1,
        },
      );
    } catch {
      /* persistent recovery */
    }
  }
}
