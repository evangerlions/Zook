import { InvestmentService, investmentId } from "../investment.service.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import {
  keys,
  object,
  integer,
  fail,
  digest,
} from "../../learning/native-learning.validation.ts";
import {
  ruleFields,
  templateFields,
  definitionDigest,
} from "./screen.validation.ts";
import type { Definition, TemplateFields } from "./screen.types.ts";
export class ScreenDefinitions extends InvestmentService {
  get store() {
    return this.repo.investments.screening;
  }
  async readDefinition(
    o: LightTickOwner,
    kind: "rules" | "templates",
    id: string,
    version?: number,
  ) {
    investmentId(id);
    if (version !== undefined) integer(version, 1, 100);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const d = await this.store.definition(o, kind, id, version);
      if (!d) fail(404, "Definition version not found.");
      return d;
    });
  }
  async writeDefinition(
    o: LightTickOwner,
    kind: "rules" | "templates",
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    investmentId(id);
    keys(b, ["base_revision", "fields"]);
    const base = integer(b.base_revision, 0, 99),
      fields =
        kind === "rules" ? ruleFields(b.fields) : templateFields(b.fields);
    if (Buffer.byteLength(JSON.stringify(b)) > 16000)
      fail(413, "Definition exceeds bounded text capacity.");
    return this.command(
      o,
      key,
      "investment_screen_" + kind,
      id,
      "save",
      b,
      async (now) => {
        const old = await this.store.definition(o, kind, id);
        if ((old?.revision ?? 0) !== base)
          fail(
            409,
            "Definition changed; retain baseline, local and cloud copies.",
          );
        if (old?.archived)
          fail(409, "Restore archived definition before editing.");
        if (!old && (await this.store.definitions(o, kind)).length >= 200)
          fail(413, "Definition catalog exceeds 200 entries.");
        if (kind === "templates")
          await this.templateContext(
            o,
            fields as TemplateFields,
            old?.kind === "templates"
              ? (old.fields as TemplateFields)
              : undefined,
          );
        const d = {
          id,
          kind,
          revision: base + 1,
          fields,
          definition_digest: digest(fields),
          request_key: key,
          archived: false,
          created_at: old?.created_at ?? now,
          updated_at: now,
        } as Definition;
        await this.store.saveDefinition(o, d, base);
        return d;
      },
    );
  }
  async templateContext(
    o: LightTickOwner,
    f: TemplateFields,
    old?: TemplateFields,
  ) {
    const rule = await this.store.definition(
        o,
        "rules",
        f.rule.id,
        f.rule.version,
      ),
      current = await this.store.definition(o, "rules", f.rule.id);
    if (
      !rule ||
      !current ||
      rule.definition_digest !== f.rule.definition_digest ||
      definitionDigest(rule) !== f.rule.definition_digest
    )
      fail(404, "Exact rule version/digest is unavailable.");
    if (
      current.archived &&
      (!old || JSON.stringify(old.rule) !== JSON.stringify(f.rule))
    )
      fail(409, "Restore rule before adding a reference.");
    if (f.account_id) {
      const a = await this.repo.investments.account(o, f.account_id);
      if (!a || a.archived) fail(404, "Template account unavailable.");
    }
    for (const id of f.instrument_ids) {
      const i = await this.repo.investments.instrument(o, id);
      if (!i || i.archived) fail(404, "Template pool instrument unavailable.");
    }
    return rule as Definition<"rules">;
  }
  async archiveDefinition(
    o: LightTickOwner,
    kind: "rules" | "templates",
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
      "investment_screen_" + kind,
      id,
      archived ? "archive" : "restore",
      b,
      async (now) => {
        const old = await this.store.definition(o, kind, id);
        if (!old) fail(404, "Definition not found.");
        if (old.revision !== base || old.archived === archived)
          fail(409, "Definition revision or archive state changed.");
        const d = {
          ...old,
          revision: base + 1,
          request_key: key,
          archived,
          updated_at: now,
        };
        await this.store.saveDefinition(o, d, base);
        return d;
      },
    );
  }
  async listDefinitions(
    o: LightTickOwner,
    kind: "rules" | "templates",
    cursor = "",
    limit = 20,
    archived = false,
  ) {
    integer(limit, 1, 50);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const all = await this.store.definitions(o, kind);
      if (all.length > 200) fail(413, "Definition catalog exceeds capacity.");
      return page(
        all.filter((d) => archived || !d.archived),
        [o, kind, archived],
        cursor,
        limit,
        (d) => d.id,
      );
    });
  }
  async definitionHistory(
    o: LightTickOwner,
    kind: "rules" | "templates",
    id: string,
    cursor = "",
    limit = 10,
  ) {
    investmentId(id);
    integer(limit, 1, 20);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const d = await this.store.definition(o, kind, id);
      if (!d) fail(404, "Definition not found.");
      const scope = digest([o, kind, id, d.revision]);
      let before = d.revision + 1;
      if (cursor) {
        const c = decode(cursor);
        if (
          c.scope !== scope ||
          !Number.isInteger(c.before) ||
          c.before < 1 ||
          c.before > before
        )
          fail(409, "History changed; retain drafts and rebuild reads.");
        before = c.before;
      }
      const rows = await this.store.versions(o, kind, id, before, limit + 1),
        items = rows.slice(0, limit);
      return {
        items,
        revision: d.revision,
        next_cursor:
          rows.length > limit
            ? encode({ scope, before: items.at(-1)!.revision })
            : null,
      };
    });
  }
}
const encode = (v: object) =>
  Buffer.from(JSON.stringify(v)).toString("base64url");
function decode(cursor: string): Record<string, any> {
  try {
    if (cursor.length > 2048) throw Error();
    const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (!c || typeof c !== "object" || Array.isArray(c)) throw Error();
    return c;
  } catch {
    fail(409, "Cursor invalid; retain drafts and original requests.");
  }
}
export function page<T>(
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
      fail(409, "Catalog changed; retain drafts and rebuild reads.");
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
