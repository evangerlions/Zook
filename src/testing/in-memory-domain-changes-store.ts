import type {
  LightTickOwner,
  LightTickChangeRow,
} from "../modules/lighttick/lighttick.types.ts";
import {
  domainHint,
  type Domain,
  type DomainHint,
  type DomainChange,
  type DomainChangesRepository,
} from "../modules/lighttick/domain-changes/domain-changes.types.ts";
const same = (a: LightTickOwner, b: LightTickOwner) =>
  a.appId === b.appId && a.userId === b.userId;
export class InMemoryDomainChangesStore implements DomainChangesRepository {
  constructor(
    readonly rows: () => LightTickChangeRow[],
    readonly push: (row: Omit<LightTickChangeRow, "sequence">) => void,
  ) {}
  async append(o: LightTickOwner, raw: DomainHint) {
    const hint = domainHint(raw),
      entityId = JSON.stringify([hint.domain, hint.resource, hint.id]);
    if (
      this.rows().some(
        (r) =>
          same(r, o) &&
          r.entityType === "domain" &&
          r.entityId === entityId &&
          r.entityVersion === hint.revision &&
          r.operation === hint.operation,
      )
    )
      return;
    this.push({
      ...o,
      entityType: "domain",
      entityId,
      entityVersion: hint.revision,
      operation: hint.operation,
      snapshot: { ...hint },
      changedAt: new Date().toISOString(),
    });
  }
  private matching(o: LightTickOwner, domain: Domain | null) {
    return this.rows().filter(
      (r) =>
        same(r, o) &&
        r.entityType === "domain" &&
        (domain === null || r.snapshot?.domain === domain),
    );
  }
  async head(o: LightTickOwner, domain: Domain | null) {
    return String(this.matching(o, domain).at(-1)?.sequence ?? 0);
  }
  async page(
    o: LightTickOwner,
    domain: Domain | null,
    after: string,
    limit: number,
  ): Promise<DomainChange[]> {
    return this.matching(o, domain)
      .filter((r) => BigInt(r.sequence) > BigInt(after))
      .slice(0, limit)
      .map((r) => ({
        ...domainHint(r.snapshot),
        sequence: String(r.sequence),
        notified_at: r.changedAt,
      }));
  }
}
