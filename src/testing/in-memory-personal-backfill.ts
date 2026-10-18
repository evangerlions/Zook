import { randomUUID } from "node:crypto";
import type { FrogSleepEntityRecord } from "../shared/types.ts";
import type { PersonalSyncState, PersonalVersion, PersonalReceipt } from "../modules/frogsleep/personal-sync/personal-sync.types.ts";
function canonical(value: unknown): string {
  if(Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if(value && typeof value === "object") return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a===b ? 0 : a<b ? -1 : 1).map(([k,v])=>[k,JSON.parse(canonical(v))])));
  return JSON.stringify(value);
}
/** Imports legacy test records into immutable private revisions with the same duplicate policy as migration 071. */
export function backfillMemoryPersonalAccount(records: FrogSleepEntityRecord[], userId: string) {
  const state: PersonalSyncState={epoch:randomUUID(),cursorSecret:randomUUID(),sequence:0,legacyAllowed:true,deleted:false};
  const versions: PersonalVersion[]=[], seen=new Map<string,Set<string>>();
  const old=records.filter(r=>r.appId==="frogsleep" && r.ownerUserId===userId && !r.deletedAt && (r.kind==="sleep_report_snapshot" || r.kind==="progress_snapshot" && r.payload.namespace==="report_preferences"))
    .sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  const preferences = old.filter(r=>r.kind==="progress_snapshot").sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id))[0];
  for(const row of old.filter(r=>r.kind!=="progress_snapshot" || r===preferences)) {
    const kind=row.kind==="sleep_report_snapshot" ? "sleep_report" : "report_preferences";
    const id=kind==="sleep_report" ? String(row.payload.snapshot_id || row.id) : "report_preferences";
    const data=kind==="sleep_report" ? {snapshot_id:id,report_id:row.payload.report_id ?? id,schema_version:row.payload.schema_version,recorded_at:row.payload.recorded_at,date_anchor:row.payload.date_anchor ?? null,report_type:row.payload.report_type ?? "sleep_report",data:row.payload.data ?? {}} : row.payload;
    const key=JSON.stringify([kind,id]), hash=canonical(data), hashes=seen.get(key) ?? new Set<string>();
    if(hashes.has(hash)) continue;
    const resource=hashes.size && kind==="sleep_report" ? `__legacy_conflict__:${row.id}` : id;
    hashes.add(hash);seen.set(key,hashes);
    versions.push({kind,id:resource,data,sequence:++state.sequence,revision:1,deleted:false,created_at:row.createdAt,updated_at:row.updatedAt});
  }
  return {state, versions, receipts:new Map<string,PersonalReceipt>()};
}
