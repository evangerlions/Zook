import {
  materialSources,
  resolveMaterials,
} from "../materials/material.validation.ts";
import { InvestmentService, investmentId } from "../investment.service.ts";
import { researchId, researchInput } from "./research.validation.ts";
import type { ResearchEntry, ResearchSummary } from "./research.types.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import {
  digest,
  keys,
  integer,
  fail,
} from "../../learning/native-learning.validation.ts";
export class ResearchService extends InvestmentService {
  async readEntry(o: LightTickOwner, id: string) {
    researchId(id);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const e = await this.repo.investments.research.get(o, id);
      if (!e) fail(404, "Research was not found.");
      return e;
    });
  }
  async write(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    researchId(id);
    const { base, fields } = researchInput(b);
    return this.command(
      o,
      key,
      "investment_research",
      id,
      "save",
      b,
      async (now) => {
        const store = this.repo.investments.research,
          old = await store.get(o, id);
        if ((old?.revision ?? 0) !== base)
          fail(
            409,
            "Research changed; retain baseline, local and cloud copies.",
          );
        if (old?.archived)
          fail(409, "Restore archived research before editing.");
        if (old && old.instrument_id !== fields.instrument_id)
          fail(409, "Research instrument identity is immutable.");
        if (!old && (await store.list(o)).length >= 500)
          fail(413, "Research catalog exceeds 500 entries.");
        if (
          fields.evidence.some(
            (e) => Date.parse(e.available_at) > Date.parse(now),
          )
        )
          fail(422, "Evidence cannot be declared available in the future.");
        const instrument = await this.repo.investments.instrument(
          o,
          fields.instrument_id,
        );
        if (!instrument || instrument.archived)
          fail(404, "Research instrument is unavailable.");
        if (fields.account_id) {
          const a = await this.repo.investments.account(o, fields.account_id);
          if (!a || a.archived)
            fail(404, "Optional research account is unavailable.");
        }
        const market = await this.repo.investments.market.summaries(
          o,
          fields.instrument_id,
        );
        if (market.length > 1000)
          fail(413, "Market sources exceed this bounded catalog.");
        for (const s of fields.market_sources)
          if (
            !market.some(
              (m) =>
                m.id === s.id &&
                m.revision === s.version &&
                m.input_digest === s.input_digest,
            )
          )
            fail(
              404,
              "Exact market source is unavailable for this owner and instrument.",
            );
        const refs =
          b.material_sources === undefined
            ? old?.material_sources
            : materialSources(b.material_sources);
        if (refs)
          await resolveMaterials(
            this.repo,
            o,
            refs,
            old?.material_sources ?? [],
            fields,
          );
        const e: ResearchEntry = {
          ...(refs ? { material_sources: refs } : {}),
          ...fields,
          id,
          request_key: key,
          revision: base + 1,
          archived: false,
          created_at: old?.created_at ?? now,
          updated_at: now,
        };
        await store.save(o, e, base);
        return e;
      },
    );
  }
  async archive(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
    archived: boolean,
  ) {
    researchId(id);
    keys(b, ["base_revision"]);
    const base = integer(b.base_revision, 1, 99);
    return this.command(
      o,
      key,
      "investment_research",
      id,
      archived ? "archive" : "restore",
      b,
      async (now) => {
        const old = await this.repo.investments.research.get(o, id);
        if (!old) fail(404, "Research was not found.");
        if (old.revision !== base)
          fail(409, "Research changed; compare current revision.");
        if (old.archived === archived)
          fail(409, "Research already has this archive state.");
        const e = {
          ...old,
          request_key: key,
          revision: base + 1,
          archived,
          updated_at: now,
        };
        await this.repo.investments.research.save(o, e, base);
        return e;
      },
    );
  }
  async listEntries(
    o: LightTickOwner,
    instrument: unknown,
    cursor = "",
    limit = 20,
    archived = false,
  ) {
    const instrument_id =
      instrument === undefined ? undefined : investmentId(instrument);
    integer(limit, 1, 100);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const all = await this.repo.investments.research.list(o, instrument_id);
      if (all.length > 500) fail(413, "Research catalog exceeds capacity.");
      const rows = all.filter((e) => archived || !e.archived),
        revision = digest(rows),
        scope = digest([o, instrument_id ?? null, archived]);
      let after = "";
      if (cursor) {
        const c = decode(cursor);
        if (
          c.scope !== scope ||
          c.revision !== revision ||
          typeof c.after !== "string"
        )
          fail(
            409,
            "Research catalog changed; rebuild the list and retain drafts.",
          );
        after = c.after;
      }
      const remaining = rows.filter((e) => e.id > after),
        items: ResearchSummary[] = remaining.slice(0, limit);
      return {
        items,
        revision,
        next_cursor:
          remaining.length > limit
            ? encode({ scope, revision, after: items.at(-1)!.id })
            : null,
      };
    });
  }
  async history(o: LightTickOwner, id: string, cursor = "", limit = 10) {
    researchId(id);
    integer(limit, 1, 20);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const latest = await this.repo.investments.research.get(o, id);
      if (!latest) fail(404, "Research was not found.");
      const scope = digest([o, id, latest.revision]);
      let before = latest.revision + 1;
      if (cursor) {
        const c = decode(cursor);
        if (
          c.scope !== scope ||
          !Number.isInteger(c.before) ||
          c.before < 1 ||
          c.before > before
        )
          fail(
            409,
            "Research history changed; refresh without discarding drafts.",
          );
        before = c.before;
      }
      const rows = await this.repo.investments.research.versions(
          o,
          id,
          before,
          limit + 1,
        ),
        items = rows.slice(0, limit);
      return {
        items,
        revision: latest.revision,
        next_cursor:
          rows.length > limit
            ? encode({ scope, before: items.at(-1)!.revision })
            : null,
      };
    });
  }
}
function encode(v: object) {
  return Buffer.from(JSON.stringify(v)).toString("base64url");
}
function decode(cursor: string): Record<string, any> {
  try {
    if (cursor.length > 2048) throw Error();
    const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (!c || Array.isArray(c) || typeof c !== "object") throw Error();
    return c;
  } catch {
    fail(409, "Research cursor is invalid; retain drafts and rebuild reads.");
  }
}
