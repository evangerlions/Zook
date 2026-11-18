import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { BucketRepository, BucketSnapshot } from "../modules/lighttick/investments/buckets/bucket.types.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";

const ownerKey = (o: LightTickOwner) => JSON.stringify([o.appId, o.userId]);
export class InMemoryInvestmentBucketStore implements BucketRepository {
  private rows = new Map<string, BucketSnapshot[]>();

  async get(o: LightTickOwner, account: string, revision?: number) {
    const rows = (this.rows.get(ownerKey(o)) ?? []).filter(r => r.account_id === account);
    return structuredClone(revision === undefined ? rows.at(-1) : rows.find(r => r.revision === revision));
  }

  async versions(o: LightTickOwner, account: string) {
    return (this.rows.get(ownerKey(o)) ?? []).filter(r => r.account_id === account).reverse()
      .map(({ revision, effective_at, base_account_revision }) => ({ revision, effective_at, base_account_revision }));
  }

  async append(o: LightTickOwner, value: BucketSnapshot) {
    const key = ownerKey(o);
    const rows = this.rows.get(key) ?? [];
    if (rows.some(r => r.account_id === value.account_id && r.revision === value.revision))
      fail(409, "Allocation revision changed.");
    this.rows.set(key, [...rows, structuredClone(value)]);
  }

  async export(o: LightTickOwner) {
    const rows = this.rows.get(ownerKey(o)) ?? [];
    if (rows.length > 5000 || Buffer.byteLength(JSON.stringify(rows)) > 8 * 1024 * 1024)
      fail(413, "Bucket export exceeds capacity.");
    return structuredClone(rows).sort((a, b) => a.account_id.localeCompare(b.account_id) || a.revision - b.revision);
  }

  snapshot() { return structuredClone([...this.rows]); }
  restore(rows: ReturnType<InMemoryInvestmentBucketStore["snapshot"]>) { this.rows = new Map(rows); }
  deleteOwner(o: LightTickOwner) { this.rows.delete(ownerKey(o)); }
}
