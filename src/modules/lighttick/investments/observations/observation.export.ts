import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import { fail } from "../../learning/native-learning.validation.ts";
export async function exportObservations(
  repo: LightTickRepository,
  o: LightTickOwner,
) {
  const store = repo.investments.observations,
    entries = [],
    versions = [],
    receipts = [],
    works = [];
  let bytes = 0,
    count = 0;
  const bound = (v: unknown) => {
    bytes += Buffer.byteLength(JSON.stringify(v));
    if (++count > 5000 || bytes > 8 * 1024 * 1024)
      fail(
        413,
        "Observation export requires chunks; no partial export returned.",
      );
  };
  for (const kind of [
    "predictions",
    "feedback",
    "monitors",
    "events",
  ] as const) {
    const rows = await store.list(o, kind);
    if (rows.length > 1000) fail(413, "Observation export exceeds capacity.");
    for (const summary of rows) {
      const row = (await store.get(o, kind, summary.id))!;
      bound(row);
      entries.push(row);
      for (let version = row.revision; version >= 1; version--) {
        const v = await store.get(o, kind, row.id, version);
        if (!v) throw Error("Observation version provenance missing");
        const op = await repo.getOperation(o, v.request_key);
        if (
          !op ||
          op.entityId !==
            (kind === "events" && v.revision === 1
              ? (v.fields as any).work_id
              : v.id) ||
          op.entityType !==
            (kind === "events" && v.revision === 1
              ? "investment_observation_work"
              : "investment_observation_" + kind)
        )
          throw Error("Observation original receipt missing");
        const receipt = {
          kind,
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
  }
  const all = await store.works(o);
  if (all.length > 300) fail(413, "Observation work export capacity exceeded.");
  for (const summary of all) {
    const w = await store.work(o, summary.id);
    if (!w) throw Error("Work disappeared in owner snapshot");
    const commands = [];
    for (const key of w.command_keys) {
      const op = await repo.getOperation(o, key);
      if (
        !op ||
        op.entityType !== "investment_observation_work" ||
        op.entityId !== w.id
      )
        throw Error("Work original receipt missing");
      commands.push({
        key,
        action: op.action,
        body: op.requestPayload,
        result: op.resultPayload,
      });
    }
    const { appId, userId, fence, lease_until, command_keys, ...safe } = w,
      row = { ...safe, commands };
    bound(row);
    works.push(row);
  }
  return { entries, versions, receipts, works };
}
