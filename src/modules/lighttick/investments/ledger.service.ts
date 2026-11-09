import { projectLedger, ledgerRows } from "./ledger.projection.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { JobQueue } from "../../../infrastructure/queue/job-queue.ts";
import type { LedgerWork } from "./ledger.types.ts";
import { InvestmentService, investmentId } from "./investment.service.ts";
import { ledgerInput } from "./ledger.validation.ts";
import {
  keys,
  integer,
  digest,
  fail,
} from "../learning/native-learning.validation.ts";
export const INVESTMENT_LEDGER_JOB = "lighttick.investment.ledger";
export const LEDGER_LIMITS = {
  events: 10000,
  work: 1000,
  attempts: 3,
  leaseMs: 120000,
};
export class InvestmentLedgerService extends InvestmentService {
  constructor(
    repo: LightTickRepository,
    readonly queue: JobQueue,
    authorize: () => Promise<void> = async () => {},
    clock = () => new Date(),
  ) {
    super(repo, authorize, clock);
  }
  get store() {
    return this.repo.investments.ledger;
  }
  data(w: LedgerWork) {
    return {
      id: w.id,
      account_id: w.account_id,
      revision: w.revision,
      base_revision: w.base_revision,
      status: w.status,
      attempt: w.attempt,
      error_code: w.error_code,
      input: w.input,
      output: w.output,
      created_at: w.created_at,
      updated_at: w.updated_at,
    };
  }
  async append(
    o: LightTickOwner,
    account: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    investmentId(account);
    const base = integer(b.base_revision, 1, 2147483646),
      input = ledgerInput(
        b,
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(this.clock()),
      );
    const id = "inv-" + digest([o, account, key]).slice(0, 40);
    const result = await this.command(
      o,
      key,
      "investment_ledger",
      account,
      "append",
      b,
      async (now) => {
        const a = await this.repo.investments.account(o, account);
        if (!a) fail(404, "Account was not found.");
        if (a.archived || a.revision !== base)
          fail(
            409,
            "Account context changed; compare before submitting a new command.",
          );
        if (input.business_date < a.baseline_date)
          fail(422, "An event cannot predate the opening baseline.");
        if ((await this.store.count(o, account)) >= LEDGER_LIMITS.work)
          fail(413, "Ledger work exceeds the bounded account capacity.");
        if(input.kind==="correction"){
          const rows=await this.store.events(o,account);
          projectLedger([...rows,{id,account_id:account,sequence:a.revision+1,input,created_at:now}]);
          if(input.correction.replacement && input.correction.replacement.business_date<a.baseline_date)fail(422,"Replacement predates opening baseline.");
        }
        await this.validateInstrument(o, input);
        const row: LedgerWork = {
          ...o,
          id,
          account_id: account,
          revision: 1,
          base_revision: base,
          request_key: key,
          input,
          status: "queued",
          attempt: 0,
          fence: null,
          lease_until: null,
          error_code: null,
          output: null,
          created_at: now,
          updated_at: now,
        };
        await this.store.save(row, 0);
        return this.data(row);
      },
    );
    await this.dispatch(o, id);
    return this.work(o, result.id);
  }
  async validateInstrument(o: LightTickOwner, input: LedgerWork["input"]) {
    if(input.kind==="correction") {
      if(input.correction.replacement)await this.validateInstrument(o,input.correction.replacement);
      return;
    }
    if (input.kind !== "fill") return;
    const i = await this.repo.investments.instrument(
      o,
      input.fill.instrument_id,
    );
    if (!i) fail(404, "Fill instrument is unavailable for this owner.");
    if (i.archived) fail(409, "Fill instrument is archived.");
    if ((i.kind === "fund") !== (input.fill.source === "fund_confirmation"))
      fail(
        422,
        "Fund fills require the explicit confirmation source; other fills cannot claim it.",
      );
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
        INVESTMENT_LEDGER_JOB,
        { app_id: o.appId, user_id: o.userId, work_id: id },
        {
          attempts: 3,
          backoffMs: 2000,
          jobId: "investment-" + digest([o, id, w.revision]).slice(0, 40),
        },
      );
    } catch {
      /* Persisted work is the outbox; the existing worker recovery will retry dispatch. */
    }
  }
  async work(o: LightTickOwner, id: string) {
    investmentId(id);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const w = await this.store.get(o, id);
      if (!w) fail(404, "Ledger work was not found.");
      return this.data(w);
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
      "investment_ledger_work",
      id,
      "cancel",
      b,
      async (now) => {
        const w = await this.store.get(o, id);
        if (!w) fail(404, "Ledger work was not found.");
        if (w.revision !== base || !["queued", "running"].includes(w.status))
          fail(409, "Ledger work is already terminal or changed.");
        const next: LedgerWork = {
          ...w,
          revision: base + 1,
          status: "cancelled",
          fence: null,
          lease_until: null,
          error_code: "CANCELLED",
          updated_at: now,
        };
        await this.terminal(next, w.revision);
        return this.data(next);
      },
    );
  }
  async terminal(w: LedgerWork, base: number) {
    await this.store.save(w, base);
    const original = await this.repo.getOperation(w, w.request_key);
    if (
      !original ||
      original.entityType !== "investment_ledger" ||
      original.entityId !== w.account_id ||
      original.action !== "append"
    )
      throw Error("Ledger original receipt is unavailable.");
    // Common operation receipts remain immutable; this durable domain row is the terminal receipt.
  }
  async ledger(o: LightTickOwner, account: string, cursor = "", limit = 50, schema = "1") {
    investmentId(account);
    integer(limit, 1, 100);
    if(!["1","2"].includes(schema))fail(422,"Unsupported ledger_schema.");
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const a = await this.repo.investments.account(o, account);
      if (!a) fail(404, "Account was not found.");
      const rows = await this.store.events(o, account);
      if (rows.length > LEDGER_LIMITS.events)
        fail(413, "Ledger event capacity exceeded.");
      const portfolioFacts=await this.repo.investments.portfolio.facts(o,account);
      if(portfolioFacts.length>500)fail(413,"Portfolio verification history exceeds capacity.");
      const unresolved=portfolioFacts.filter(f=>f.kind==="notice"&&f.status==="open").length;
      if(schema!=="2" && (a.baseline_version>1||unresolved>0||rows.some(e=>e.input.kind==="correction")))fail(409,"LEDGER_SCHEMA_UPGRADE_REQUIRED: request ledger_schema=2; retain local drafts and pending requests.");
      const revision = digest([account, a.revision, rows, ...(schema==="2"?[schema]:[])]);
      let offset = 0;
      if (cursor) {
        try {
          if (cursor.length > 2048) throw Error();
          const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
          if (
            c.owner !== digest(o) ||
            c.revision !== revision ||
            !Number.isInteger(c.offset) ||
            c.offset < 0 ||
            c.offset > rows.length
          )
            throw Error();
          offset = c.offset;
        } catch {
          fail(
            409,
            "Ledger snapshot changed; rebuild read pages and retain local commands.",
          );
        }
      }
      const originalReport = await this.store.latest(o, account),baselineReport=await this.repo.investments.portfolio.baselineReport(o,account);
      const report=baselineReport&&baselineReport.account_revision>(originalReport?.account_revision??0)?baselineReport:originalReport;
      return {
        account_revision: a.revision,
        ...(unresolved?{unresolved_portfolio_notices:unresolved}:{}),
        items: (schema==="2"?ledgerRows(rows):rows).slice(offset, offset + limit),
        report,
        next_cursor:
          rows.length > offset + limit
            ? Buffer.from(
                JSON.stringify({
                  owner: digest(o),
                  revision,
                  offset: offset + limit,
                }),
              ).toString("base64url")
            : null,
      };
    });
  }
}
