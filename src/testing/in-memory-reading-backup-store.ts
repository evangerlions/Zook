import type { DomainNotifier } from "../modules/lighttick/domain-changes/domain-changes.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type {
  ReadingBackupRepository,
  ReadingBackupSection,
  ReadingBackupRecord,
  ReadingBackupManifest,
  ReadingBackupPart,
} from "../modules/lighttick/reading/reading-backup.types.ts";
const prefix = (o: LightTickOwner) => JSON.stringify([o.appId, o.userId]) + ":";
export class InMemoryReadingBackupStore implements ReadingBackupRepository {
  private rows = new Map<
    string,
    {
      owner: LightTickOwner;
      expires: string;
      manifest?: ReadingBackupManifest;
      parts: ReadingBackupPart[];
    }
  >();
  constructor(
    readonly entries: (
      o: LightTickOwner,
      section: ReadingBackupSection,
      after: string,
      limit: number,
    ) => Promise<ReadingBackupRecord[]>,
    readonly notify: DomainNotifier = async () => {},
  ) {}
  snapshot() {
    return structuredClone([...this.rows]);
  }
  restore(rows: ReturnType<InMemoryReadingBackupStore["snapshot"]>) {
    this.rows = new Map(rows);
  }
  async expiredOwners(now: string, limit: number) {
    const owners = new Map<string, LightTickOwner>();
    for (const row of this.rows.values())
      if (row.expires <= now) owners.set(prefix(row.owner), row.owner);
    return structuredClone([...owners.values()].slice(0, limit));
  }
  async list(o: LightTickOwner) {
    return structuredClone(
      [...this.rows]
        .filter(([k, r]) => k.startsWith(prefix(o)) && r.manifest)
        .map(([, r]) => r.manifest!)
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
  }
  async get(o: LightTickOwner, id: string) {
    return structuredClone(this.rows.get(prefix(o) + id)?.manifest);
  }
  async part(o: LightTickOwner, id: string, index: number) {
    return structuredClone(
      this.rows.get(prefix(o) + id)?.parts.find((p) => p.index === index),
    );
  }
  async begin(o: LightTickOwner, id: string, expires: string) {
    const k = prefix(o) + id;
    if (this.rows.has(k)) throw Error("Immutable backup identity conflict");
    this.rows.set(k, { owner: { ...o }, expires, parts: [] });
  }
  async savePart(o: LightTickOwner, id: string, part: ReadingBackupPart) {
    const row = this.rows.get(prefix(o) + id)!;
    if (row.parts.some((p) => p.index === part.index))
      throw Error("Immutable backup part conflict");
    row.parts.push(structuredClone(part));
  }
  async finish(o: LightTickOwner, manifest: ReadingBackupManifest) {
    const row = this.rows.get(prefix(o) + manifest.id)!;
    if (row.manifest) throw Error("Immutable backup conflict");
    row.manifest = structuredClone(manifest);
    await this.notify(o, {
      domain: "reading",
      resource: "backup",
      id: manifest.id,
      revision: manifest.revision,
      operation: "upsert",
    });
  }
  async delete(o: LightTickOwner, id: string) {
    const prior = this.rows.get(prefix(o) + id)?.manifest;
    this.rows.delete(prefix(o) + id);
    if (prior)
      await this.notify(o, {
        domain: "reading",
        resource: "backup",
        id,
        revision: prior.revision,
        operation: "delete",
      });
  }
  async prune(o: LightTickOwner, now: string) {
    for (const [k, row] of this.rows)
      if (k.startsWith(prefix(o)) && row.expires <= now)
        await this.delete(o, k.slice(prefix(o).length));
  }
  async invalidate(o: LightTickOwner) {
    for (const k of this.rows.keys())
      if (k.startsWith(prefix(o)))
        await this.delete(o, k.slice(prefix(o).length));
  }
}
