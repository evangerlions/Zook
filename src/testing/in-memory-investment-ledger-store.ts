import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type {
  LedgerEvent,
  LedgerWork,
  InvestmentLedgerRepository,
} from "../modules/lighttick/investments/ledger.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner, id: string) =>
  JSON.stringify([o.appId, o.userId, id]);
const prefix = (o: LightTickOwner) =>
  JSON.stringify([o.appId, o.userId]).slice(0, -1) + ",";
export class InMemoryInvestmentLedgerStore
  implements InvestmentLedgerRepository
{
  private facts = new Map<
    string,
    { owner: LightTickOwner; event: LedgerEvent }
  >();
  private work = new Map<string, LedgerWork>();
  async events(o: LightTickOwner, id: string) {
    return structuredClone(
      [...this.facts.values()]
        .filter(
          (r) =>
            r.owner.appId === o.appId &&
            r.owner.userId === o.userId &&
            r.event.account_id === id,
        )
        .map((r) => r.event)
        .sort(
          (a, b) =>
            a.input.business_date.localeCompare(b.input.business_date) ||
            a.sequence - b.sequence,
        )
        .slice(0, 10001),
    );
  }
  async append(o: LightTickOwner, e: LedgerEvent) {
    if (this.facts.has(key(o, e.id))) throw Error("Duplicate ledger fact");
    this.facts.set(key(o, e.id), structuredClone({ owner: o, event: e }));
  }
  async get(o: LightTickOwner, id: string) {
    return structuredClone(this.work.get(key(o, id)));
  }
  async save(r: LedgerWork, base: number) {
    if ((this.work.get(key(r, r.id))?.revision ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Ledger work changed.",
      );
    this.work.set(key(r, r.id), structuredClone(r));
  }
  async count(o: LightTickOwner, id: string) {
    return [...this.work.values()].filter(
      (r) =>
        r.appId === o.appId && r.userId === o.userId && r.account_id === id,
    ).length;
  }
  async latest(o: LightTickOwner, id: string) {
    return structuredClone(
      [...this.work.values()]
        .filter(
          (r) =>
            r.appId === o.appId &&
            r.userId === o.userId &&
            r.account_id === id &&
            r.status === "succeeded",
        )
        .sort(
          (a, b) => b.output!.account_revision - a.output!.account_revision,
        )[0]?.output ?? null,
    );
  }
  async list(o: LightTickOwner, id: string) {
    let bytes=0;for(const r of this.work.values())if(r.appId===o.appId&&r.userId===o.userId&&r.account_id===id){bytes+=Buffer.byteLength(JSON.stringify(r));if(bytes>8*1024*1024)throw new ApplicationError(413,"VALIDATION_ERROR","Ledger receipt export exceeds 8 MiB.");}
    return structuredClone(
      [...this.work.values()]
        .filter(
          (r) =>
            r.appId === o.appId && r.userId === o.userId && r.account_id === id,
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, 1001),
    );
  }
  async recoverable(now: string, limit: number) {
    return structuredClone(
      [...this.work.values()]
        .filter(
          (r) =>
            r.status === "queued" ||
            (r.status === "running" && r.lease_until! <= now),
        )
        .slice(0, limit),
    );
  }
  snapshot() {
    return structuredClone({ facts: [...this.facts], work: [...this.work] });
  }
  restore(s: ReturnType<InMemoryInvestmentLedgerStore["snapshot"]>) {
    this.facts = new Map(s.facts);
    this.work = new Map(s.work);
  }
  deleteOwner(o: LightTickOwner) {
    for (const map of [this.facts, this.work])
      for (const k of map.keys()) if (k.startsWith(prefix(o))) map.delete(k);
  }
}
