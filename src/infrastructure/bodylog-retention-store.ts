export type RetentionKind = "grant" | "participation";
export interface RetentionDocument {
  id: string;
  kind: RetentionKind;
  userId: string;
  data: Record<string, unknown>;
}
export interface GrantSummary { source: string; type: string; state: "active" | "queued" | "expired" | "issued"; count: number }
export interface BodyLogRetentionStore {
  grantSummary(now: string): Promise<GrantSummary[]>;
  list(kind: RetentionKind, userId: string): Promise<RetentionDocument[]>;
  save(document: RetentionDocument): Promise<void>;
}
export class InMemoryBodyLogRetentionStore implements BodyLogRetentionStore {
  private readonly documents = new Map<string, RetentionDocument>();
  async list(kind: RetentionKind, userId: string) {
    return structuredClone([...this.documents.values()].filter(item => item.kind === kind && item.userId === userId));
  }
  async grantSummary(now: string): Promise<GrantSummary[]> {
    const rows = new Map<string, GrantSummary>();
    for (const {kind,data} of this.documents.values()) {
      if (kind !== "grant") continue;
      const state = data.type !== "premium" ? "issued" : Date.parse(String(data.endsAt)) <= Date.parse(now) ? "expired"
        : Date.parse(String(data.startsAt)) > Date.parse(now) ? "queued" : "active";
      const key = JSON.stringify([data.source,data.type,state]);
      const row = rows.get(key) ?? {source:String(data.source),type:String(data.type),state,count:0};
      row.count++;rows.set(key,row);
    }
    return [...rows.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  async save(document: RetentionDocument) { this.documents.set(document.id, structuredClone(document)); }
}
