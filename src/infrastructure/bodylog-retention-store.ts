export type RetentionKind = "grant" | "participation";
export interface RetentionDocument {
  id: string;
  kind: RetentionKind;
  userId: string;
  data: Record<string, unknown>;
}
export interface BodyLogRetentionStore {
  list(kind: RetentionKind, userId: string): Promise<RetentionDocument[]>;
  save(document: RetentionDocument): Promise<void>;
}
export class InMemoryBodyLogRetentionStore implements BodyLogRetentionStore {
  private readonly documents = new Map<string, RetentionDocument>();
  async list(kind: RetentionKind, userId: string) {
    return structuredClone([...this.documents.values()].filter(item => item.kind === kind && item.userId === userId));
  }
  async save(document: RetentionDocument) { this.documents.set(document.id, structuredClone(document)); }
}
