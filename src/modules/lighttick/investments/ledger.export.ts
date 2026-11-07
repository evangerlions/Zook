import {exportScreening} from "./screening/screen.export.ts";
import {exportMaterials} from "./materials/material.export.ts";
import {exportResearch} from "./research/research.export.ts";
import {exportMarket} from "./market/market.export.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import { fail } from "../learning/native-learning.validation.ts";
/** Caller holds the owner snapshot. Export domain facts/receipts, never queue leases or credentials. */
export async function exportInvestments(
  repo: LightTickRepository,
  o: LightTickOwner,
) {
  const accounts = await repo.investments.accounts(o),
    instruments = await repo.investments.instruments(o),
    ledgers = [];
  if (accounts.length > 1000 || instruments.length > 1000)
    fail(413, "Investment export exceeds catalog capacity.");
  let rows = accounts.length + instruments.length;
  for (const a of accounts) {
    const events = await repo.investments.ledger.events(o, a.id),
      work = await repo.investments.ledger.list(o, a.id);
    rows += events.length + work.length;
    if (events.length > 10000 || work.length > 1000 || rows > 5000)
      fail(
        413,
        "Investment export exceeds 5000 rows; no truncated export is returned.",
      );
    const receipts = [];
    for (const w of work) {
      const original = await repo.getOperation(o, w.request_key);
      if (
        !original ||
        original.entityType !== "investment_ledger" ||
        original.entityId !== a.id ||
        original.action !== "append"
      )
        throw Error("Investment receipt provenance is unavailable.");
      receipts.push({
        id: w.id,
        account_id: w.account_id,
        revision: w.revision,
        base_revision: w.base_revision,
        request_key: w.request_key,
        request_body: original.requestPayload,
        input: w.input,
        status: w.status,
        error_code: w.error_code,
        output: w.output,
        created_at: w.created_at,
        updated_at: w.updated_at,
      });
    }
    ledgers.push({ account_id: a.id, events, receipts });
  }
  const screening=await exportScreening(repo,o);
  const materials=await exportMaterials(repo,o);
  return { ...(screening.definitions.length||screening.runs.length?{screening}:{}), ...(materials.entries.length?{materials}:{}), instruments, accounts, ledgers, market:await exportMarket(repo,o), research:await exportResearch(repo,o) };
}
