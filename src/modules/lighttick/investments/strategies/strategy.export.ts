import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import { fail } from "../../learning/native-learning.validation.ts";
/** Called inside the existing consistent owner export. Originals and full input, never internal leases. */
export async function exportStrategies(
  repo: LightTickRepository,
  o: LightTickOwner,
) {
  const store = repo.investments.strategies,
    definitions = await store.definitions(o),
    versions = [],
    receipts = [],
    runs = [];
  let bytes = 0,
    count = 0;
  const bound = (v: unknown) => {
    bytes += Buffer.byteLength(JSON.stringify(v));
    if (++count > 5000 || bytes > 8 * 1024 * 1024)
      fail(
        413,
        "Strategy export requires chunks; no truncated export returned.",
      );
  };
  if (definitions.length > 200) fail(413, "Strategy export capacity exceeded.");
  for (const d of definitions) {
    bound(d);
    for (let version = d.revision; version >= 1; version--) {
      const v = await store.definition(o, d.id, version);
      if (!v) throw Error("Strategy history missing");
      const op = await repo.getOperation(o, v.request_key);
      if (
        !op ||
        op.entityType !== "investment_strategy" ||
        op.entityId !== d.id
      )
        throw Error("Strategy original receipt missing");
      const receipt = {
        id: v.id,
        revision: v.revision,
        key: v.request_key,
        body: op.requestPayload,
        result: op.resultPayload,
      };
      bound([v, receipt]);
      versions.push(v);
      receipts.push(receipt);
    }
  }
  const summaries = await store.works(o);
  if (summaries.length > 100) fail(413, "Backtest export capacity exceeded.");
  for (const summary of summaries) {
    const w = await store.work(o, summary.id);
    if (!w) throw Error("Backtest missing in owner snapshot");
    const commands = [];
    for (const key of w.command_keys) {
      const op = await repo.getOperation(o, key);
      if (
        !op ||
        op.entityType !== "investment_backtest" ||
        op.entityId !== w.id
      )
        throw Error("Backtest original receipt missing");
      commands.push({
        key,
        action: op.action,
        body: op.requestPayload,
        result: op.resultPayload,
      });
    }
    const { appId, userId, fence, lease_until, command_keys, ...work } = w;
    const row = { ...work, commands };
    bound(row);
    runs.push(row);
  }
  return { definitions, versions, receipts, runs };
}
