import { InvestmentService, investmentId } from "../investment.service.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import { evidenceInput } from "../research/research.validation.ts";
import { materialDigest, materialMetadata } from "./material.validation.ts";
import type { Material } from "./material.types.ts";
import {
  keys,
  integer,
  fail,
  digest,
} from "../../learning/native-learning.validation.ts";
export class MaterialService extends InvestmentService {
  async readMaterial(o: LightTickOwner, id: string, version?: number) {
    investmentId(id);
    if (version !== undefined) integer(version, 1, 100);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const s = this.repo.investments.materials,
        m =
          version === undefined
            ? await s.get(o, id)
            : await s.version(o, id, version);
      if (!m) fail(404, "Material version was not found.");
      return m;
    });
  }
  async write(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    investmentId(id);
    keys(b, [
      "base_revision",
      "instrument_id",
      "account_id",
      "period_end",
      "title",
      "content",
      "locator",
      "source_url",
      "available_at",
      "contrary_evidence",
    ]);
    const base = integer(b.base_revision, 0, 99),
      { base_revision, instrument_id, account_id, period_end, ...input } = b,
      fields = evidenceInput(input);
    return this.command(
      o,
      key,
      "investment_material",
      id,
      "save",
      b,
      async (now) => {
        const s = this.repo.investments.materials,
          old = await s.get(o, id);
        if ((old?.revision ?? 0) !== base)
          fail(
            409,
            "Material changed; retain baseline, local and cloud copies.",
          );
        if (old?.archived)
          fail(409, "Restore archived material before editing.");
        if (!old && (await s.list(o)).length >= 500)
          fail(413, "Material catalog exceeds 500 entries.");
        if (Date.parse(fields.available_at) > Date.parse(now))
          fail(422, "Material cannot be declared available in the future.");
        const metadata = materialMetadata(b, old);
        if (metadata.instrument_id) {
          const i = await this.repo.investments.instrument(
            o,
            metadata.instrument_id,
          );
          if (!i || (i.archived && old?.instrument_id !== i.id))
            fail(404, "Material instrument unavailable for this owner.");
        }
        if (metadata.account_id) {
          const a = await this.repo.investments.account(o, metadata.account_id);
          if (!a || (a.archived && old?.account_id !== a.id))
            fail(404, "Material account unavailable for this owner.");
        }
        const m: Material = {
          ...metadata,
          ...fields,
          id,
          revision: base + 1,
          request_key: key,
          content_digest: "",
          archived: false,
          created_at: old?.created_at ?? now,
          updated_at: now,
        };
        m.content_digest = materialDigest(m);
        await s.save(o, m, base);
        return m;
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
    investmentId(id);
    keys(b, ["base_revision"]);
    const base = integer(b.base_revision, 1, 99);
    return this.command(
      o,
      key,
      "investment_material",
      id,
      archived ? "archive" : "restore",
      b,
      async (now) => {
        const s = this.repo.investments.materials,
          old = await s.get(o, id);
        if (!old) fail(404, "Material was not found.");
        if (old.revision !== base || old.archived === archived)
          fail(409, "Material revision or archive state changed.");
        const m = {
          ...old,
          revision: base + 1,
          request_key: key,
          archived,
          updated_at: now,
        };
        await s.save(o, m, base);
        return m;
      },
    );
  }
  async listMaterials(
    o: LightTickOwner,
    cursor = "",
    limit = 20,
    archived = false,
  ) {
    integer(limit, 1, 100);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const all = await this.repo.investments.materials.list(o);
      if (all.length > 500) fail(413, "Material catalog exceeds capacity.");
      return page(
        all.filter((m) => archived || !m.archived),
        [o, "materials", archived],
        cursor,
        limit,
        (m) => m.id,
      );
    });
  }
  async history(o: LightTickOwner, id: string, cursor = "", limit = 10) {
    investmentId(id);
    integer(limit, 1, 20);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const s = this.repo.investments.materials,
        current = await s.get(o, id);
      if (!current) fail(404, "Material was not found.");
      const scope = digest([o, id, current.revision]);
      let before = current.revision + 1;
      if (cursor) {
        const c = decode(cursor);
        if (
          c.scope !== scope ||
          !Number.isInteger(c.before) ||
          c.before < 1 ||
          c.before > before
        )
          fail(409, "History changed; retain drafts and rebuild the list.");
        before = c.before;
      }
      const rows = await s.versions(o, id, before, limit + 1),
        items = rows.slice(0, limit);
      return {
        items,
        revision: current.revision,
        next_cursor:
          rows.length > limit
            ? encode({ scope, before: items.at(-1)!.revision })
            : null,
      };
    });
  }
  async references(o: LightTickOwner, id: string, cursor = "", limit = 20) {
    investmentId(id);
    integer(limit, 1, 100);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      if (!(await this.repo.investments.materials.get(o, id)))
        fail(404, "Material was not found.");
      const rows = await this.repo.investments.materials.references(o, id);
      if (rows.length > 500) fail(413, "References exceed catalog capacity.");
      return page(
        rows,
        [o, "material-references", id],
        cursor,
        limit,
        (r) => r.research_id,
      );
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
    fail(409, "Invalid material cursor; retain drafts and rebuild reads.");
  }
}
function page<T>(
  rows: T[],
  scopeValue: unknown,
  cursor: string,
  limit: number,
  id: (r: T) => string,
) {
  const scope = digest(scopeValue),
    revision = digest(rows);
  let after = "";
  if (cursor) {
    const c = decode(cursor);
    if (
      c.scope !== scope ||
      c.revision !== revision ||
      typeof c.after !== "string" ||
      !rows.some((r) => id(r) === c.after)
    )
      fail(409, "Material catalog changed; retain drafts and rebuild reads.");
    after = c.after;
  }
  const rest = rows.filter((r) => id(r) > after),
    items = rest.slice(0, limit);
  return {
    items,
    revision,
    next_cursor:
      rest.length > limit
        ? encode({ scope, revision, after: id(items.at(-1)!) })
        : null,
  };
}
