import type {
  JournalRepository,
  JournalState,
} from "../modules/lighttick/investments/journal/journal.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner) => JSON.stringify([o.appId, o.userId]);
export class InMemoryInvestmentJournalStore implements JournalRepository {
  private rows = new Map<string, JournalState>();
  async get(o: LightTickOwner) {
    return structuredClone(this.rows.get(key(o)));
  }
  async save(o: LightTickOwner, s: JournalState, base: number) {
    if ((this.rows.get(key(o))?.revision ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Investment journal changed.",
      );
    this.rows.set(key(o), structuredClone(s));
  }
  snapshot() {
    return structuredClone([...this.rows]);
  }
  restore(rows: ReturnType<InMemoryInvestmentJournalStore["snapshot"]>) {
    this.rows = new Map(rows);
  }
  deleteOwner(o: LightTickOwner) {
    this.rows.delete(key(o));
  }
}
