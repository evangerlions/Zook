import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type {
  MarketRepository,
  MarketWork,
  MarketSnapshot,
} from "../modules/lighttick/investments/market/market-work.types.ts";
import { marketSummary } from "../modules/lighttick/investments/market/market-work.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner, id: string) =>
    JSON.stringify([o.appId, o.userId, id]),
  prefix = (o: LightTickOwner) =>
    JSON.stringify([o.appId, o.userId]).slice(0, -1) + ",";
export class InMemoryMarketStore implements MarketRepository {
  private work = new Map<string, MarketWork>();
  private data = new Map<
    string,
    { owner: LightTickOwner; snapshot: MarketSnapshot }
  >();
  async get(o: LightTickOwner, id: string) {
    return structuredClone(this.work.get(key(o, id)));
  }
  async save(w: MarketWork, base: number) {
    if ((this.work.get(key(w, w.id))?.revision ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Market work changed.",
      );
    this.work.set(key(w, w.id), structuredClone(w));
  }
  async count(o: LightTickOwner, since = "") {
    return [...this.work].filter(
      ([k, w]) => k.startsWith(prefix(o)) && w.created_at >= since,
    ).length;
  }
  async active(o: LightTickOwner, now: string) {
    return [...this.work].filter(
      ([k, w]) =>
        k.startsWith(prefix(o)) &&
        w.status === "running" &&
        w.lease_until! > now,
    ).length;
  }
  async recoverable(now: string, limit: number) {
    const owners = new Map<string, number>();
    return structuredClone(
      [...this.work.values()]
        .filter(
          (w) =>
            w.status === "queued" ||
            (w.status === "running" && w.lease_until! <= now),
        )
        .sort(
          (a, b) =>
            a.created_at.localeCompare(b.created_at) ||
            a.id.localeCompare(b.id),
        )
        .filter((w) => {
          const k = JSON.stringify([w.appId, w.userId]),
            n = owners.get(k) ?? 0;
          owners.set(k, n + 1);
          return n < 2;
        })
        .slice(0, limit),
    );
  }
  async snapshot(o: LightTickOwner, id: string) {
    return structuredClone(this.data.get(key(o, id))?.snapshot);
  }
  async publish(o: LightTickOwner, s: MarketSnapshot) {
    if (
      this.data.has(key(o, s.id)) ||
      [...this.data.values()].some(
        (r) =>
          r.owner.appId === o.appId &&
          r.owner.userId === o.userId &&
          r.snapshot.work_id === s.work_id,
      )
    )
      throw Error("Duplicate market snapshot");
    this.data.set(key(o, s.id), structuredClone({ owner: o, snapshot: s }));
  }
  async summaries(o: LightTickOwner, instrument?: string) {
    return structuredClone(
      [...this.data]
        .filter(
          ([k, r]) =>
            k.startsWith(prefix(o)) &&
            (!instrument || r.snapshot.instrument_id === instrument),
        )
        .map(([, r]) => marketSummary(r.snapshot))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, 1001),
    );
  }
  async works(o: LightTickOwner) {
    const rows = [...this.work]
      .filter(([k]) => k.startsWith(prefix(o)))
      .map(([, w]) => w)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, 1001);
    if (Buffer.byteLength(JSON.stringify(rows)) > 8 * 1024 * 1024)
      throw new ApplicationError(
        413,
        "VALIDATION_ERROR",
        "Market receipt export exceeds capacity.",
      );
    return structuredClone(rows);
  }
  state() {
    return structuredClone({ work: [...this.work], data: [...this.data] });
  }
  restore(s: ReturnType<InMemoryMarketStore["state"]>) {
    this.work = new Map(s.work);
    this.data = new Map(s.data);
  }
  deleteOwner(o: LightTickOwner) {
    for (const m of [this.work, this.data])
      for (const k of m.keys()) if (k.startsWith(prefix(o))) m.delete(k);
  }
}
