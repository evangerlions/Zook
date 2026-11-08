import { projectLedger, LEDGER_PROJECTION_VERSION } from "./ledger.projection.ts";
import { randomUUID } from "node:crypto";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { InvestmentAccount } from "./investment.types.ts";
import type { LedgerEvent, LedgerWork, LedgerReport } from "./ledger.types.ts";
import { InvestmentLedgerService, LEDGER_LIMITS } from "./ledger.service.ts";
import { reconcile, ACCOUNTING_VERSION } from "./accounting.ts";
import { digest, fail } from "../learning/native-learning.validation.ts";
export function calculateLedger(
  a: InvestmentAccount,
  events: LedgerEvent[],
): LedgerReport {
  if (events.length > LEDGER_LIMITS.events)
    fail(413, "Ledger calculation exceeds the bounded capacity.");
  const ordered = [...events].sort(
    (x, y) =>
      x.input.business_date.localeCompare(y.input.business_date) ||
      x.sequence - y.sequence,
  );
  const effective = projectLedger(events).active;
  const cash = effective.flatMap((e) =>
      e.input.kind === "cash" ? [e.input.cash] : [],
    ),
    fills = effective.flatMap((e) =>
      e.input.kind === "fill" ? [e.input.fill] : [],
    );
  const output: LedgerReport = {
    account_id: a.id,
    account_revision: a.revision + 1,
    baseline_version: a.baseline_version,
    algorithm_version: ACCOUNTING_VERSION,
    input_digest: digest({
      baseline: {
        version: a.baseline_version,
        date: a.baseline_date,
        cash: a.opening_cash,
        positions: a.opening_positions,
      },
      events: ordered,
    }),
    event_count: ordered.length,
    ...(events.some(e=>e.input.kind==="correction")?{effective_event_count:effective.length,correction_count:events.filter(e=>e.input.kind==="correction").length,projection_version:LEDGER_PROJECTION_VERSION}:{}),
    valuation: "unpriced",
    result: reconcile(a.opening_cash, cash, fills, a.opening_positions, {}),
  };
  if (Buffer.byteLength(JSON.stringify(output)) > 8 * 1024 * 1024)
    fail(413, "Ledger result exceeds capacity.");
  return output;
}
export class InvestmentLedgerRunner {
  constructor(
    readonly service: InvestmentLedgerService,
    readonly authorizeOwner: (
      o: LightTickOwner,
    ) => Promise<void> = async () => {},
    readonly calculate = async (a: InvestmentAccount, e: LedgerEvent[]) =>
      calculateLedger(a, e),
  ) {}
  get repo() {
    return this.service.repo;
  }
  get store() {
    return this.service.store;
  }
  get now() {
    return this.service.clock().toISOString();
  }
  async recover() {
    const rows = await this.store.recoverable(this.now, 100);
    for (const w of rows) await this.service.dispatch(w, w.id);
    return rows.length;
  }
  private async invalid(w: LedgerWork) {
    await this.authorizeOwner(w);
    const a = await this.repo.investments.account(w, w.account_id);
    if (!a || a.archived || a.revision !== w.base_revision)
      throw Error("ACCOUNT_CONTEXT_CHANGED");
    await this.service.validateInstrument(w, w.input);
    return a;
  }
  private async failed(w: LedgerWork, code: string) {
    const next: LedgerWork = {
      ...w,
      revision: w.revision + 1,
      status: "failed",
      fence: null,
      lease_until: null,
      error_code: code,
      updated_at: this.now,
    };
    await this.service.terminal(next, w.revision);
    return next;
  }
  async execute(o: LightTickOwner, id: string) {
    const snapshot = await this.repo.transaction(o, async () => {
      const w = await this.store.get(o, id);
      if (
        !w ||
        !["queued", "running"].includes(w.status) ||
        (w.status === "running" && w.lease_until! > this.now)
      )
        return;
      if (w.attempt >= LEDGER_LIMITS.attempts) {
        await this.failed(w, "ATTEMPTS_EXHAUSTED");
        return;
      }
      let a: InvestmentAccount;
      try {
        a = await this.invalid(w);
      } catch {
        await this.failed(w, "ACCOUNT_CONTEXT_CHANGED");
        return;
      }
      const events = await this.store.events(o, w.account_id);
      if (events.length >= LEDGER_LIMITS.events) {
        await this.failed(w, "LEDGER_CAPACITY_EXCEEDED");
        return;
      }
      const next: LedgerWork = {
        ...w,
        revision: w.revision + 1,
        status: "running",
        attempt: w.attempt + 1,
        fence: randomUUID(),
        lease_until: new Date(
          this.service.clock().getTime() + LEDGER_LIMITS.leaseMs,
        ).toISOString(),
        error_code: null,
        updated_at: this.now,
      };
      await this.store.save(next, w.revision);
      return { work: next, account: a, events };
    });
    if (!snapshot) return;
    const { work: w, account: a, events } = snapshot,
      event: LedgerEvent = {
        id: w.id,
        account_id: w.account_id,
        sequence: a.revision + 1,
        input: w.input,
        created_at: w.created_at,
      };
    let output: LedgerReport | null = null,
      error: string | null = null;
    // The existing worker process owns bounded computation. No owner transaction is held here.
    try {
      output = await this.calculate(a, [...events, event]);
    } catch (e: any) {
      error =
        e?.statusCode === 422
          ? "LEDGER_INPUT_INVALID"
          : e?.statusCode === 413
            ? "LEDGER_CAPACITY_EXCEEDED"
            : "LEDGER_CALCULATION_FAILED";
    }
    return this.repo.transaction(o, async () => {
      const current = await this.store.get(o, id);
      if (
        !current ||
        current.status !== "running" ||
        current.fence !== w.fence ||
        current.lease_until! <= this.now
      )
        return;
      try {
        await this.invalid(current);
      } catch {
        error = "ACCOUNT_CONTEXT_CHANGED";
      }
      if (error) return this.failed(current, error);
      await this.repo.investments.saveAccount(
        o,
        { ...a, revision: a.revision + 1, updated_at: this.now },
        a.revision,
      );
      await this.store.append(o, event);
      const next: LedgerWork = {
        ...current,
        revision: current.revision + 1,
        status: "succeeded",
        fence: null,
        lease_until: null,
        error_code: null,
        output,
        updated_at: this.now,
      };
      await this.service.terminal(next, current.revision);
      return next;
    });
  }
}
