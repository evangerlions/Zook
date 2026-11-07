import {InMemoryObservationStore} from "./in-memory-observation-store.ts";
import {InMemoryScreeningStore} from "./in-memory-screening-store.ts";
import {InMemoryMaterialStore} from "./in-memory-material-store.ts";
import {InMemoryResearchStore} from "./in-memory-research-store.ts";
import {InMemoryMarketStore} from "./in-memory-market-store.ts";
import {InMemoryInvestmentLedgerStore} from "./in-memory-investment-ledger-store.ts";
import type {
  InvestmentRepository,
  InvestmentAccount,
  InvestmentInstrument,
} from "../modules/lighttick/investments/investment.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner, id: string) =>
    JSON.stringify([o.appId, o.userId, id]),
  prefix = (o: LightTickOwner) =>
    JSON.stringify([o.appId, o.userId]).slice(0, -1) + ",";
export class InMemoryInvestmentStore implements InvestmentRepository {
  readonly observations=new InMemoryObservationStore();
  readonly screening=new InMemoryScreeningStore();
  readonly research=new InMemoryResearchStore();
  readonly materials=new InMemoryMaterialStore(this.research);
  readonly market=new InMemoryMarketStore();
  readonly ledger=new InMemoryInvestmentLedgerStore();
  private symbols = new Map<string, InvestmentInstrument>();
  private wallets = new Map<string, InvestmentAccount>();
  async instrument(o: LightTickOwner, id: string) {
    return structuredClone(this.symbols.get(key(o, id)));
  }
  async instrumentByCode(o: LightTickOwner, market: string, code: string) {
    return (await this.instruments(o)).find(
      (i) => i.market === market && i.code === code,
    );
  }
  async instruments(o: LightTickOwner) {
    return structuredClone(
      [...this.symbols]
        .filter(([k]) => k.startsWith(prefix(o)))
        .map(([, v]) => v)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, 1001),
    );
  }
  async saveInstrument(
    o: LightTickOwner,
    i: InvestmentInstrument,
    base: number,
  ) {
    if (
      (this.symbols.get(key(o, i.id))?.revision ?? 0) !== base ||
      (base === 0 && (await this.instrumentByCode(o, i.market, i.code)))
    )
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Instrument changed.",
      );
    this.symbols.set(key(o, i.id), structuredClone(i));
  }
  async account(o: LightTickOwner, id: string) {
    const row = this.wallets.get(key(o, id));
    if (!row) return;
    return structuredClone({
      ...row,
      opening_instruments: row.opening_positions
        .map((p) => this.symbols.get(key(o, p.instrument_id)))
        .filter((i): i is InvestmentInstrument => !!i),
    });
  }
  async accounts(o: LightTickOwner) {
    const rows = [...this.wallets]
      .filter(([k]) => k.startsWith(prefix(o)))
      .map(([, v]) => v)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, 1001);
    return Promise.all(rows.map((r) => this.account(o, r.id).then((v) => v!)));
  }
  async saveAccount(o: LightTickOwner, a: InvestmentAccount, base: number) {
    if ((this.wallets.get(key(o, a.id))?.revision ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Account changed.",
      );
    this.wallets.set(key(o, a.id), structuredClone(a));
  }
  snapshot() {
    return structuredClone({
      observations:this.observations.snapshot(),screening:this.screening.snapshot(),
      materials:this.materials.snapshot(),
      research:this.research.snapshot(),
      market:this.market.state(),
      ledger:this.ledger.snapshot(),
      symbols: [...this.symbols],
      wallets: [...this.wallets],
    });
  }
  restore(v: ReturnType<InMemoryInvestmentStore["snapshot"]>) {
    this.observations.restore(v.observations);this.screening.restore(v.screening);
    this.materials.restore(v.materials);
    this.research.restore(v.research);
    this.market.restore(v.market);
    this.ledger.restore(v.ledger);
    this.symbols = new Map(v.symbols);
    this.wallets = new Map(v.wallets);
  }
  deleteOwner(o: LightTickOwner) {
    this.observations.deleteOwner(o);this.screening.deleteOwner(o);
    this.materials.deleteOwner(o);
    this.research.deleteOwner(o);
    this.market.deleteOwner(o);
    this.ledger.deleteOwner(o);
    for (const map of [this.symbols, this.wallets])
      for (const k of map.keys()) if (k.startsWith(prefix(o))) map.delete(k);
  }
}
