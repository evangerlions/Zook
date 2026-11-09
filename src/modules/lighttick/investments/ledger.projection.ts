import type { LedgerEvent, LedgerFact } from "./ledger.types.ts";
import { digest, fail } from "../learning/native-learning.validation.ts";
export const LEDGER_PROJECTION_VERSION = "immutable-ledger-corrections-v1";
/** Sequence defines the immutable correction graph; business dates define later accounting order. */
export function projectLedger(events: LedgerEvent[]) {
  const current = new Map<string, LedgerFact | null>();
  const originals = new Map<string, LedgerEvent>();
  const superseded = new Map<string, string>();
  const accountingOrder = new Map<string, number>();
  for (const e of [...events].sort((a,b) => a.sequence-b.sequence)) {
    if (originals.has(e.id)) fail(409, "Duplicate ledger event identity.");
    originals.set(e.id,e);
    if (e.input.kind !== "correction") { current.set(e.id,e.input); accountingOrder.set(e.id,e.sequence); continue; }
    const c=e.input.correction;
    if (!current.has(c.target_event_id)) fail(409, "Correction target is missing or already superseded.");
    if (originals.get(c.target_event_id)?.account_id !== e.account_id) fail(409, "Correction account does not match target.");
    if (digest(current.get(c.target_event_id)) !== c.target_input_digest) fail(409,"Correction target digest changed.");
    accountingOrder.set(e.id,accountingOrder.get(c.target_event_id)!);
    current.delete(c.target_event_id); superseded.set(c.target_event_id,e.id); current.set(e.id,c.replacement);
  }
  const active: (Omit<LedgerEvent,"input"> & {input: LedgerFact})[]=[];
  for (const [id,input] of current) if (input !== null) active.push({...originals.get(id)!,sequence:accountingOrder.get(id)!,input});
  active.sort((a,b)=>a.input.business_date.localeCompare(b.input.business_date)||a.sequence-b.sequence);
  return {active,current,superseded};
}
export function ledgerRows(events: LedgerEvent[]) {
  const p=projectLedger(events);
  return events.map(e=>({...e,
    effective_fact:p.current.has(e.id)?{input:p.current.get(e.id)!,input_digest:digest(p.current.get(e.id))}:null,
    superseded_by:p.superseded.get(e.id)??null,
  }));
}
