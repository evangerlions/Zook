import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import type { JobQueue } from "../../../../infrastructure/queue/job-queue.ts";
import { InvestmentService, investmentId } from "../investment.service.ts";
import type { MarketWork, MarketInput } from "./market-work.types.ts";
import {
  keys,
  integer,
  text,
  digest,
  fail,
} from "../../learning/native-learning.validation.ts";
import { marketDate, shanghaiClock } from "./market.validation.ts";
function requestDate(value:unknown):string {try{return marketDate(value);}catch{fail(422,'Market dates must be valid YYYY-MM-DD values.');}}
export const MARKET_WORK_JOB = "lighttick.investment.market";
export const MARKET_LIMITS = {
  jobs: 1000,
  dailyJobs: 100,
  leaseMs: 120000,
  attempts: 3,
};
export class MarketWorkService extends InvestmentService {
  constructor(
    repo: LightTickRepository,
    readonly queue: JobQueue,
    authorize: () => Promise<void> = async () => {},
    clock = () => new Date(),
  ) {
    super(repo, authorize, clock);
  }
  get store() {
    return this.repo.investments.market;
  }
  view(w: MarketWork) {
    const { csv, ...input } = w.input;
    return {
      id: w.id,
      instrument_id: w.instrument_id,
      base_revision: w.base_revision,
      revision: w.revision,
      input,
      status: w.status,
      attempt: w.attempt,
      error_code: w.error_code,
      snapshot_id: w.snapshot_id,
      created_at: w.created_at,
      updated_at: w.updated_at,
    };
  }
  async create(o: LightTickOwner, b: Record<string, unknown>, key: string) {
    keys(b, [
      "instrument_id",
      "base_revision",
      "supplier",
      "start",
      "end",
      "csv",
      "declared_source",
      "volume_unit",
      "amount_unit",
    ]);
    const id = investmentId(b.instrument_id),
      base = integer(b.base_revision, 1, 2147483646),
      supplier = text(b.supplier, 16, true) as MarketInput["supplier"],
      start = requestDate(b.start),
      end = requestDate(b.end);
    if (
      !["csv", "tushare", "eastmoney", "tencent"].includes(supplier) ||
      start > end ||
      Date.parse(end) - Date.parse(start) > 369 * 86400000 ||
      end > shanghaiClock(this.clock()).slice(0, 10)
    )
      fail(422, "Select one supplier and a valid completed historical range.");
    const input: MarketInput = {
      instrument_id: id,
      base_revision: base,
      supplier,
      start,
      end,
    };
    if (supplier === "csv") {
      if (
        typeof b.csv !== "string" ||
        !b.csv.trim() ||
        b.csv.length > 256000 ||
        Buffer.byteLength(b.csv) > 256000
      )
        fail(413, "CSV exceeds capacity or is empty.");
      input.csv = b.csv;
      input.declared_source = text(b.declared_source, 200, true);
      if (
        !["shares", "lots100"].includes(String(b.volume_unit)) ||
        !["CNY", "thousand_CNY", "ten_thousand_CNY"].includes(
          String(b.amount_unit),
        )
      )
        fail(422, "Declare source units explicitly.");
      input.volume_unit = b.volume_unit as any;
      input.amount_unit = b.amount_unit as any;
    } else if (
      ["csv", "declared_source", "volume_unit", "amount_unit"].some(
        (k) => b[k] !== undefined,
      )
    )
      fail(422, "CSV fields cannot accompany a network supplier.");
    const workId = "inv-" + digest([o, id, key, "market-daily"]).slice(0, 40);
    const result = await this.command(
      o,
      key,
      "investment_market",
      id,
      "daily",
      b,
      async (now) => {
        const instrument = await this.repo.investments.instrument(o, id);
        if (!instrument) fail(404, "Instrument was not found.");
        if (instrument.archived || instrument.revision !== base)
          fail(409, "Instrument context changed.");
        if (
          (await this.store.count(o)) >= MARKET_LIMITS.jobs ||
          (await this.store.count(o, now.slice(0, 10) + "T00:00:00.000Z")) >=
            MARKET_LIMITS.dailyJobs
        )
          fail(429, "Market work budget is exhausted.");
        const w: MarketWork = {
          ...o,
          id: workId,
          instrument_id: id,
          base_revision: base,
          revision: 1,
          request_key: key,
          input,
          status: "queued",
          attempt: 0,
          fence: null,
          lease_until: null,
          error_code: null,
          snapshot_id: null,
          created_at: now,
          updated_at: now,
        };
        await this.store.save(w, 0);
        return this.view(w);
      },
    );
    await this.dispatch(o, result.id);
    return this.readWork(o, result.id);
  }
  async dispatch(o: LightTickOwner, id: string) {
    const w = await this.store.get(o, id);
    if (
      !w ||
      (w.status !== "queued" &&
        !(
          w.status === "running" && w.lease_until! <= this.clock().toISOString()
        ))
    )
      return;
    try {
      await this.queue.add(
        MARKET_WORK_JOB,
        { app_id: o.appId, user_id: o.userId, work_id: id },
        {
          attempts: 3,
          backoffMs: 2000,
          jobId: "market-" + digest([o, id, w.revision]).slice(0, 40),
        },
      );
    } catch {
      /* Durable work remains queued for the existing worker recovery. */
    }
  }
  async readWork(o: LightTickOwner, id: string) {
    investmentId(id);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const w = await this.store.get(o, id);
      if (!w) fail(404, "Market work was not found.");
      return this.view(w);
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
      "investment_market_cancel",
      id,
      "cancel",
      b,
      async (now) => {
        const w = await this.store.get(o, id);
        if (!w) fail(404, "Market work was not found.");
        if (w.revision !== base || !["queued", "running"].includes(w.status))
          fail(409, "Market work is terminal or changed.");
        const next: MarketWork = {
          ...w,
          revision: base + 1,
          status: "cancelled",
          fence: null,
          lease_until: null,
          error_code: "CANCELLED",
          updated_at: now,
        };
        await this.terminal(next, w.revision);
        return this.view(next);
      },
    );
  }
  async terminal(w: MarketWork, base: number) {
    const original = await this.repo.getOperation(w, w.request_key);
    if (
      !original ||
      original.entityType !== "investment_market" ||
      original.entityId !== w.instrument_id ||
      original.action !== "daily"
    )
      throw Error("Market original receipt is unavailable.");
    await this.store.save(w, base);
  }
  async readSnapshot(o: LightTickOwner, id: string) {
    investmentId(id);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const s = await this.store.snapshot(o, id);
      if (!s) fail(404, "Market snapshot was not found.");
      return s;
    });
  }
  async listSnapshots(
    o: LightTickOwner,
    instrument: string | undefined,
    cursor = "",
    limit = 20,
  ) {
    if (instrument) investmentId(instrument);
    integer(limit, 1, 100);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const rows = await this.store.summaries(o, instrument);
      if (rows.length > 1000) fail(413, "Market catalog exceeds capacity.");
      const revision = digest(rows);
      let after = "";
      if (cursor)
        try {
          if (cursor.length > 2048) throw Error();
          const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
          if (
            c.owner !== digest(o) ||
            c.filter !== (instrument ?? "") ||
            c.revision !== revision ||
            typeof c.after !== "string"
          )
            throw Error();
          after = c.after;
        } catch {
          fail(
            409,
            "Market snapshot catalog changed; rebuild only read pages and retain local drafts.",
          );
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
                  filter: instrument ?? "",
                  revision,
                  after: page[limit - 1].id,
                }),
              ).toString("base64url")
            : null,
      };
    });
  }
}
