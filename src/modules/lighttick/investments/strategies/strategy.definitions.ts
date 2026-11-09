import { InvestmentService, investmentId } from "../investment.service.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import {
  keys,
  integer,
  fail,
  digest,
} from "../../learning/native-learning.validation.ts";
import { strategyFields } from "./strategy.validation.ts";
import { page } from "../screening/screen.definitions.ts";
export class StrategyDefinitions extends InvestmentService {
  get store() {
    return this.repo.investments.strategies;
  }
  async readDefinition(o: LightTickOwner, id: string, version?: number) {
    investmentId(id);
    if (version !== undefined) integer(version, 1, 100);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const d = await this.store.definition(o, id, version);
      if (!d) fail(404, "Strategy version unavailable.");
      return d;
    });
  }
  async writeDefinition(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    investmentId(id);
    keys(b, ["base_revision", "fields"]);
    const base = integer(b.base_revision, 0, 99),
      fields = strategyFields(b.fields);
    if (Buffer.byteLength(JSON.stringify(b)) > 16000)
      fail(413, "Strategy text exceeds capacity.");
    return this.command(
      o,
      key,
      "investment_strategy",
      id,
      "save",
      b,
      async (now) => {
        const old = await this.store.definition(o, id);
        if ((old?.revision ?? 0) !== base || old?.archived)
          fail(
            409,
            "Strategy changed or archived; retain baseline, local and cloud copies.",
          );
        if (!old && (await this.store.definitions(o)).length >= 200)
          fail(413, "Strategy catalog capacity exhausted.");
        const d = {
          id,
          revision: base + 1,
          archive_epoch: old?.archive_epoch ?? 0,
          fields,
          definition_digest: digest(fields),
          request_key: key,
          archived: false,
          created_at: old?.created_at ?? now,
          updated_at: now,
        };
        await this.store.saveDefinition(o, d, base);
        return d;
      },
    );
  }
  async archiveDefinition(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
    archived: boolean,
  ) {
    investmentId(id);
    keys(b, ["base_revision"]);
    const base = integer(b.base_revision, 1, 99);
    return this.command(
      o,
      key,
      "investment_strategy",
      id,
      archived ? "archive" : "restore",
      b,
      async (now) => {
        const old = await this.store.definition(o, id);
        if (!old) fail(404, "Strategy unavailable.");
        if (old.revision !== base || old.archived === archived)
          fail(409, "Strategy revision/archive changed.");
        const d = {
          ...old,
          revision: base + 1,
          archive_epoch: old.archive_epoch + 1,
          archived,
          request_key: key,
          updated_at: now,
        };
        await this.store.saveDefinition(o, d, base);
        return d;
      },
    );
  }
  async listDefinitions(
    o: LightTickOwner,
    cursor = "",
    limit = 20,
    archived = false,
  ) {
    integer(limit, 1, 50);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const rows = await this.store.definitions(o);
      if (rows.length > 200) fail(413, "Strategy catalog exceeds capacity.");
      return page(
        rows.filter((d) => archived || !d.archived),
        [o, "strategies", archived],
        cursor,
        limit,
        (d) => d.id,
      );
    });
  }
  async history(o: LightTickOwner, id: string, cursor = "", limit = 10) {
    investmentId(id);
    integer(limit, 1, 20);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const d = await this.store.definition(o, id);
      if (!d) fail(404, "Strategy unavailable.");
      const scope = digest([o, "strategy-history", id, d.revision]);
      let before = d.revision + 1;
      if (cursor) {
        const c = decodeCursor(cursor);
        if (
          c.scope !== scope ||
          !Number.isInteger(c.before) ||
          c.before < 1 ||
          c.before > before
        )
          fail(
            409,
            "History changed; rebuild reads and retain local drafts/original requests.",
          );
        before = c.before;
      }
      const rows = await this.store.versions(o, id, before, limit + 1),
        items = rows.slice(0, limit);
      return {
        items,
        revision: d.revision,
        next_cursor:
          rows.length > limit
            ? encodeCursor({ scope, before: items.at(-1)!.revision })
            : null,
      };
    });
  }
}
export const encodeCursor = (v: object) =>
  Buffer.from(JSON.stringify(v)).toString("base64url");
export function decodeCursor(cursor: string): Record<string, any> {
  try {
    if (cursor.length > 2048) throw Error();
    const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (!c || typeof c !== "object" || Array.isArray(c)) throw Error();
    return c;
  } catch {
    fail(409, "Cursor invalid; retain drafts and original requests.");
  }
}
