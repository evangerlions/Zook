import { InvestmentService, investmentId } from "../investment.service.ts";
import { LedgerDecimal as D } from "../decimal.ts";
import { calculateLedger } from "../ledger.runner.ts";
import { fail } from "../../learning/native-learning.validation.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import type { InvestmentAccount } from "../investment.types.ts";
import type { BucketSnapshot, BucketView } from "./bucket.types.ts";
import { allocationTotals, projectBuckets } from "./bucket.projection.ts";
import { latestSavedValuation } from "../portfolio/portfolio.types.ts";
import { bucketInput, BUCKET_LIMITS } from "./bucket.validation.ts";

function empty(account: InvestmentAccount): BucketSnapshot {
  return { account_id: account.id, base_account_revision: account.revision, revision: 0,
    effective_at: null, buckets: [], allocations: [] };
}

export class InvestmentBucketService extends InvestmentService {
  private get store() { return this.repo.investments.buckets; }

  private async account(o: LightTickOwner, id: string) {
    const row = await this.repo.investments.account(o, investmentId(id));
    if (!row) fail(404, "Investment account was not found.");
    return row;
  }

  private async context(o: LightTickOwner, account: InvestmentAccount) {
    const [events, facts] = await Promise.all([
      this.repo.investments.ledger.events(o, account.id),
      this.repo.investments.portfolio.facts(o, account.id),
    ]);
    const ledger = calculateLedger(account, events).result;
    const positions = new Map(ledger.positions.filter(row => new D(row.quantity).gt(0))
      .map(row => [row.instrument_id, row.quantity] as const));
    return { account, events, facts, positions, cash: ledger.cash_verified ? ledger.cash : null };
  }

  async view(o: LightTickOwner, id: string): Promise<BucketView> {
    const data = await this.repo.transaction(o, async () => {
      await this.authorize();
      const account = await this.account(o, id);
      const [context, saved, current, history] = await Promise.all([
        this.context(o, account), this.repo.investments.portfolio.saved(o, id),
        this.store.get(o, id), this.store.versions(o, id),
      ]);
      return { context, saved, snapshot: current ?? empty(account), history };
    });
    const { context, saved, snapshot, history } = data;
    return { snapshot, history, account_revision: context.account.revision,
      ...projectBuckets(context, snapshot, context.positions, latestSavedValuation(saved), context.cash) };
  }

  async version(o: LightTickOwner, id: string, revision: number) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      await this.account(o, id);
      const row = await this.store.get(o, id, revision);
      if (!row) fail(404, "Allocation revision was not found.");
      return row;
    });
  }

  async write(o: LightTickOwner, id: string, body: Record<string, unknown>, key: string) {
    const { base_revision, base_account_revision, buckets, allocations } = bucketInput(body);
    return this.command(o, key, "investment_buckets", id, "save", body, async now => {
      const account = await this.account(o, id);
      if (account.archived || account.revision !== base_account_revision)
        fail(409, "The account or holdings changed. Review the latest quantities before saving.");
      const prior = await this.store.get(o, id) ?? empty(account);
      if (prior.revision !== base_revision) fail(409, "Bucket allocation revision changed.");
      if (base_revision >= BUCKET_LIMITS.revisions) fail(413, "Allocation history exceeds capacity.");

      const { positions, facts } = await this.context(o, account);
      const pending = new Set(facts.filter(row => row.kind === "notice" && row.status === "open").map(row => row.instrument_id));
      const oldAssignments = new Map(prior.allocations.map(row => [row.bucket_id + "/" + row.instrument_id, row.quantity]));
      for (const row of allocations) {
        if (pending.has(row.instrument_id) && new D(row.quantity).gt(oldAssignments.get(row.bucket_id + "/" + row.instrument_id) ?? 0))
          fail(409, "Resolve the pending ledger notice before adding shares for this instrument.");
      }
      for (const [id, quantity] of allocationTotals(allocations)) {
        if (quantity.gt(positions.get(id) ?? 0)) fail(422, "Allocated shares exceed the current effective position.");
      }

      const watchIds = new Set(buckets.flatMap(row => row.kind === "watch" ? row.instrument_ids : []));
      if (watchIds.size) {
        const owned = new Set((await this.repo.investments.instruments(o)).map(row => row.id));
        if ([...watchIds].some(id => !owned.has(id))) fail(404, "A watched instrument was not found.");
      }
      const row: BucketSnapshot = { account_id: id, revision: base_revision + 1, base_account_revision,
        effective_at: now, buckets, allocations };
      await this.store.append(o, row);
      return row;
    });
  }
}
