import type { LightTickOwner } from "../lighttick.types.ts";
import type { OpeningPosition } from "./accounting.ts";
export interface InvestmentInstrument {
  id: string;
  revision: number;
  code: string;
  market: "SSE" | "SZSE" | "BSE" | "FUND";
  kind: "stock" | "etf" | "fund";
  name: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}
export interface InvestmentAccount {
  id: string;
  revision: number;
  baseline_version: number;
  name: string;
  currency: "CNY";
  baseline_date: string;
  opening_cash: string;
  opening_positions: OpeningPosition[];
  opening_instruments: InvestmentInstrument[];
  archived: boolean;
  created_at: string;
  updated_at: string;
}
export interface InvestmentRepository {
 readonly observations: import("./observations/observation.types.ts").ObservationStore;
 readonly screening: import("./screening/screen.types.ts").ScreeningRepository;
 readonly materials: import("./materials/material.types.ts").MaterialRepository;
 readonly research: import("./research/research.types.ts").ResearchRepository;
 readonly market: import("./market/market-work.types.ts").MarketRepository;
  readonly ledger: import("./ledger.types.ts").InvestmentLedgerRepository;
  instrument(
    o: LightTickOwner,
    id: string,
  ): Promise<InvestmentInstrument | undefined>;
  instrumentByCode(
    o: LightTickOwner,
    market: string,
    code: string,
  ): Promise<InvestmentInstrument | undefined>;
  instruments(o: LightTickOwner): Promise<InvestmentInstrument[]>;
  saveInstrument(
    o: LightTickOwner,
    i: InvestmentInstrument,
    base: number,
  ): Promise<void>;
  account(
    o: LightTickOwner,
    id: string,
  ): Promise<InvestmentAccount | undefined>;
  accounts(o: LightTickOwner): Promise<InvestmentAccount[]>;
  saveAccount(
    o: LightTickOwner,
    a: InvestmentAccount,
    base: number,
  ): Promise<void>;
}
