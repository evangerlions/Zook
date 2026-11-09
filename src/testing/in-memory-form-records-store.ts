import type {
  FormRecordsRepository,
  FormSnapshot,
} from "../modules/lighttick/form-records/form-records.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner) => JSON.stringify([o.appId, o.userId]);
export class InMemoryFormRecordsStore implements FormRecordsRepository {
  private rows = new Map<string, FormSnapshot>();
  async get(o: LightTickOwner) {
    return structuredClone(this.rows.get(key(o)));
  }
  async save(o: LightTickOwner, s: FormSnapshot, base: number) {
    if ((this.rows.get(key(o))?.revision ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Form records changed.",
      );
    this.rows.set(key(o), structuredClone(s));
  }
  snapshot() {
    return structuredClone([...this.rows]);
  }
  restore(rows: ReturnType<InMemoryFormRecordsStore["snapshot"]>) {
    this.rows = new Map(rows);
  }
  deleteOwner(o: LightTickOwner) {
    this.rows.delete(key(o));
  }
}
