import { reportSummary } from "../modules/lighttick/account-reports/account-report.types.ts";
import type {
  AccountReportRepository,
  AccountReportRow,
} from "../modules/lighttick/account-reports/account-report.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner, id: string) =>
  JSON.stringify([o.appId, o.userId, id]);
export class InMemoryAccountReportStore implements AccountReportRepository {
  private rows = new Map<string, AccountReportRow>();
  async get(o: LightTickOwner, id: string) {
    return structuredClone(this.rows.get(key(o, id)));
  }
  async save(row: AccountReportRow, base: number) {
    const k = key(row, row.id);
    if ((this.rows.get(k)?.revision ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "报告已变化。",
      );
    this.rows.set(k, structuredClone(row));
  }
  async list(
    o: LightTickOwner,
    offset: number,
    limit: number,
    topic: "account" | "behavior" = "account",
  ) {
    const rows = [...this.rows.values()]
      .filter(
        (r) =>
          r.appId === o.appId &&
          r.userId === o.userId &&
          r.status !== "deleted" &&
          (r.topic ?? "account") === topic,
      )
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
      );
    return {
      items: structuredClone(
        rows.slice(offset, offset + limit).map(reportSummary),
      ),
      total: rows.length,
    };
  }
  async recoverable(now: string) {
    return structuredClone(
      [...this.rows.values()]
        .filter(
          (r) =>
            r.status === "queued" ||
            (r.status === "running" && r.lease_until! <= now),
        )
        .slice(0, 100),
    );
  }
  snapshot() {
    return structuredClone([...this.rows]);
  }
  restore(rows: ReturnType<InMemoryAccountReportStore["snapshot"]>) {
    this.rows = new Map(structuredClone(rows));
  }
  deleteOwner(o: LightTickOwner) {
    for (const [k, r] of this.rows)
      if (r.appId === o.appId && r.userId === o.userId) this.rows.delete(k);
  }
}
