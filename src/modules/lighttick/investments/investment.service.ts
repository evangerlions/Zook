import type { LightTickOwner } from "../lighttick.types.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type {
  InvestmentAccount,
  InvestmentInstrument,
} from "./investment.types.ts";
import { decimalInput } from "./decimal.ts";
import {
  object,
  keys,
  text,
  integer,
  digest,
  fail,
} from "../learning/native-learning.validation.ts";
export const investmentId = (value: unknown) => {
  const id = text(value, 100, true);
  if (!/^inv-[a-zA-Z0-9_-]{8,96}$/.test(id))
    fail(422, "Invalid investment identity.");
  return id;
};
export function instrumentFields(b: Record<string, unknown>) {
  keys(b, ["code", "market", "kind", "name"]);
  const rawCode = text(b.code, 32, true);
  if (!/^[A-Za-z0-9_.-]+$/.test(rawCode))
    fail(422, "Instrument code must use the declared ASCII market identity.");
  let code = rawCode.toUpperCase();
  const market = text(b.market, 8, true),
    kind = text(b.kind, 10, true),
    name = text(b.name, 100, true);
  if (
    !/^[A-Z0-9_.-]+$/.test(code) ||
    !["SSE", "SZSE", "BSE", "FUND"].includes(market) ||
    !["stock", "etf", "fund"].includes(kind) ||
    (market === "FUND") !== (kind === "fund")
  )
    fail(422, "Instrument code, market or kind is inconsistent.");
  for (const [m, suffix] of Object.entries({
    SSE: ".SH",
    SZSE: ".SZ",
    BSE: ".BJ",
    FUND: ".OF",
  }))
    if (code.endsWith(suffix)) {
      if (market !== m)
        fail(422, "Instrument suffix belongs to another market.");
      code = code.slice(0, -suffix.length);
    }
  if (!code) fail(422, "Instrument code is required.");
  return {
    code,
    market: market as InvestmentInstrument["market"],
    kind: kind as InvestmentInstrument["kind"],
    name,
  };
}
export function accountFields(b: Record<string, unknown>) {
  keys(b, [
    "base_revision",
    "name",
    "currency",
    "baseline_date",
    "opening_cash",
    "opening_positions",
  ]);
  if (
    b.base_revision !== 0 ||
    b.currency !== "CNY" ||
    !Array.isArray(b.opening_positions) ||
    b.opening_positions.length > 100
  )
    fail(
      422,
      "New CNY account requires revision zero and at most 100 opening positions.",
    );
  const name = text(b.name, 100, true),
    date = text(b.baseline_date, 10, true);
  if (
    date < "0001-01-01" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    fail(422, "Opening baseline date is invalid.");
  const positions = b.opening_positions
    .map((raw) => {
      const p = object(raw);
      keys(p, ["instrument_id", "quantity", "cost"]);
      return {
        instrument_id: investmentId(p.instrument_id),
        quantity: decimalInput(p.quantity, true),
        cost: p.cost == null ? null : decimalInput(p.cost),
      };
    })
    .sort((a, b) => (a.instrument_id < b.instrument_id ? -1 : 1));
  if (new Set(positions.map((p) => p.instrument_id)).size !== positions.length)
    fail(422, "Opening positions cannot repeat an instrument.");
  return {
    name,
    currency: "CNY" as const,
    baseline_date: date,
    opening_cash: decimalInput(b.opening_cash),
    opening_positions: positions,
  };
}
export class InvestmentService {
  constructor(
    readonly repo: LightTickRepository,
    readonly authorize: () => Promise<void> = async () => {},
    readonly clock = () => new Date(),
  ) {}
  private command<T extends object>(
    o: LightTickOwner,
    key: string,
    entity: string,
    id: string,
    action: string,
    b: Record<string, unknown>,
    mutate: (now: string) => Promise<T>,
  ) {
    if (key.length < 8 || key.length > 128)
      fail(422, "Retain an original request identity.");
    const hash = digest({ entity, id, action, b });
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const receipt = await this.repo.getOperation(o, key);
      if (receipt) {
        if (
          receipt.payloadHash !== hash ||
          receipt.entityType !== entity ||
          receipt.entityId !== id
        )
          fail(409, "Request identity belongs to another resource or body.");
        return receipt.resultPayload as T;
      }
      const now = this.clock().toISOString(),
        result = await mutate(now);
      await this.repo.saveOperation({
        ...o,
        operationId: key,
        deviceId: "investment-http",
        payloadHash: hash,
        entityType: entity,
        entityId: id,
        action,
        requestPayload: b,
        resultPayload: result as Record<string, unknown>,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return result;
    });
  }
  async createInstrument(
    o: LightTickOwner,
    b: Record<string, unknown>,
    key: string,
  ) {
    const fields = instrumentFields(b),
      natural = fields.market + ":" + fields.code;
    return this.command(
      o,
      key,
      "investment_instrument",
      natural,
      "create",
      b,
      async (now) => {
        const existing = await this.repo.investments.instrumentByCode(
          o,
          fields.market,
          fields.code,
        );
        if (existing) {
          if (existing.kind !== fields.kind)
            fail(
              409,
              "This market/code is already registered as another instrument kind.",
            );
          return { instrument: existing, existing: true };
        }
        if ((await this.repo.investments.instruments(o)).length >= 1000)
          fail(413, "Instrument catalog exceeds this bounded slice.");
        const instrument: InvestmentInstrument = {
          ...fields,
          id: "inv-" + digest([o, natural]).slice(0, 40),
          revision: 1,
          archived: false,
          created_at: now,
          updated_at: now,
        };
        await this.repo.investments.saveInstrument(o, instrument, 0);
        return { instrument, existing: false };
      },
    );
  }
  async updateInstrument(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    investmentId(id);
    keys(b, ["base_revision", "name", "archived"]);
    const base = integer(b.base_revision, 1, 2147483646),
      name = text(b.name, 100, true);
    if (typeof b.archived !== "boolean")
      fail(422, "Archive state must be explicit.");
    return this.command(
      o,
      key,
      "investment_instrument",
      id,
      "update",
      b,
      async (now) => {
        const old = await this.repo.investments.instrument(o, id);
        if (!old) fail(404, "Instrument was not found.");
        if (old.revision !== base)
          fail(409, "Instrument changed; compare the current revision.");
        const result = {
          ...old,
          revision: base + 1,
          name,
          archived: b.archived as boolean,
          updated_at: now,
        };
        await this.repo.investments.saveInstrument(o, result, base);
        return result;
      },
    );
  }
  async createAccount(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    investmentId(id);
    const fields = accountFields(b);
    return this.command(
      o,
      key,
      "investment_account",
      id,
      "create",
      b,
      async (now) => {
        if (await this.repo.investments.account(o, id))
          fail(409, "Account identity already exists.");
        if ((await this.repo.investments.accounts(o)).length >= 1000)
          fail(413, "Account catalog exceeds this bounded slice.");
        const catalog = await this.repo.investments.instruments(o);
        for (const p of fields.opening_positions)
          if (!catalog.some((i) => i.id === p.instrument_id && !i.archived))
            fail(404, "Opening instrument is unavailable for this owner.");
        if (catalog.length > 1000)
          fail(413, "Instrument catalog exceeds this bounded slice.");
        const account: InvestmentAccount = {
          ...fields,
          opening_instruments: catalog.filter((i) =>
            fields.opening_positions.some((p) => p.instrument_id === i.id),
          ),
          id,
          revision: 1,
          baseline_version: 1,
          archived: false,
          created_at: now,
          updated_at: now,
        };
        await this.repo.investments.saveAccount(o, account, 0);
        return account;
      },
    );
  }
  async archiveAccount(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    investmentId(id);
    keys(b, ["base_revision", "archived"]);
    const base = integer(b.base_revision, 1, 2147483646);
    if (typeof b.archived !== "boolean")
      fail(422, "Archive state must be explicit.");
    return this.command(
      o,
      key,
      "investment_account",
      id,
      "archive",
      b,
      async (now) => {
        const old = await this.repo.investments.account(o, id);
        if (!old) fail(404, "Account was not found.");
        if (old.revision !== base || old.archived === b.archived)
          fail(409, "Account revision or archive state changed.");
        const result = {
          ...old,
          revision: base + 1,
          archived: b.archived as boolean,
          updated_at: now,
        };
        await this.repo.investments.saveAccount(o, result, base);
        return result;
      },
    );
  }
  async read(o: LightTickOwner, kind: "accounts" | "instruments", id: string) {
    investmentId(id);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const row =
        kind === "accounts"
          ? await this.repo.investments.account(o, id)
          : await this.repo.investments.instrument(o, id);
      if (!row) fail(404, "Investment resource was not found.");
      return row;
    });
  }
  async list(
    o: LightTickOwner,
    kind: "accounts" | "instruments",
    cursor = "",
    limit = 50,
  ) {
    integer(limit, 1, 100);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const rows = await this.repo.investments[kind](o);
      if (
        rows.length > 1000 ||
        Buffer.byteLength(JSON.stringify(rows)) > 8 * 1024 * 1024
      )
        fail(413, "Investment catalog exceeds the bounded snapshot capacity.");
      const revision = digest(rows);
      let after = "";
      if (cursor) {
        try {
          if (cursor.length > 2048) throw Error();
          const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
          if (
            c.owner !== digest(o) ||
            c.kind !== kind ||
            c.revision !== revision ||
            typeof c.after !== "string"
          )
            throw Error();
          after = c.after;
        } catch {
          fail(
            409,
            "Investment catalog changed; refresh the read-only list and retain original drafts.",
          );
        }
      }
      const page = rows.filter((r) => r.id > after);
      return {
        items: page.slice(0, limit),
        revision,
        next_cursor:
          page.length > limit
            ? Buffer.from(
                JSON.stringify({
                  owner: digest(o),
                  kind,
                  revision,
                  after: page[limit - 1].id,
                }),
              ).toString("base64url")
            : null,
      };
    });
  }
}
