import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type {
  ReadingAsset,
  ReadingAssetsRepository,
} from "../modules/lighttick/independent-reading/reading-assets.types.ts";
import {
  digest,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
const prefix = (o: LightTickOwner) => JSON.stringify([o.appId, o.userId]) + ":";
export class InMemoryReadingAssetsStore implements ReadingAssetsRepository {
  private rows = new Map<string, ReadingAsset>();
  snapshot() {
    return structuredClone([...this.rows]);
  }
  restore(rows: ReturnType<InMemoryReadingAssetsStore["snapshot"]>) {
    this.rows = new Map(rows);
  }
  deleteOwner(o: LightTickOwner) {
    for (const k of this.rows.keys())
      if (k.startsWith(prefix(o))) this.rows.delete(k);
  }
  async eraseWork(o:LightTickOwner,id:string){for(const k of this.rows.keys()) if(k.startsWith(prefix(o)+id+":")) this.rows.delete(k);}
  async get(o: LightTickOwner, workId: string, id: string) {
    return structuredClone(this.rows.get(prefix(o) + workId + ":" + id));
  }
  async list(o: LightTickOwner, workId: string) {
    return structuredClone(
      [...this.rows]
        .filter(([k]) => k.startsWith(prefix(o) + workId + ":"))
        .map(([, v]) => {
          const { value, ...meta } = v;
          return meta;
        })
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  }
  async save(o: LightTickOwner, row: ReadingAsset) {
    const k = prefix(o) + row.work_id + ":" + row.id,
      old = this.rows.get(k);
    if (old && digest(old) !== digest(row))
      fail(409, "Immutable reading asset conflict");
    this.rows.set(k, structuredClone(row));
  }
}
