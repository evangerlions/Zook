import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type {
  ModelTest,
  PersonalModelState,
  PersonalModelRepository,
} from "../modules/lighttick/personal-model/personal-model.types.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
const owner = (o: LightTickOwner) => JSON.stringify([o.appId, o.userId]),
  key = (o: LightTickOwner, id: string) => owner(o) + ":" + id;
export class InMemoryPersonalModelStore implements PersonalModelRepository {
  private settings = new Map<string, PersonalModelState>();
  private tests = new Map<string, ModelTest>();
  async get(o: LightTickOwner) {
    return structuredClone(this.settings.get(owner(o)));
  }
  async save(o: LightTickOwner, r: PersonalModelState, base: number) {
    if ((this.settings.get(owner(o))?.revision ?? 0) !== base)
      fail(409, "Model settings changed.");
    this.settings.set(owner(o), structuredClone(r));
  }
  async test(o: LightTickOwner, id: string) {
    return structuredClone(this.tests.get(key(o, id)));
  }
  async saveTest(r: ModelTest, base: number) {
    if ((this.tests.get(key(r, r.id))?.revision ?? 0) !== base)
      fail(409, "Model test changed.");
    this.tests.set(key(r, r.id), structuredClone(r));
  }
  async active(o: LightTickOwner) {
    return [...this.tests.values()].some(
      (t) => owner(t) === owner(o) && ["queued", "running"].includes(t.status),
    );
  }
  async running(o: LightTickOwner, now: string) {
    return [...this.tests.values()].filter(
      (t) =>
        owner(t) === owner(o) && t.status === "running" && t.lease_until! > now,
    ).length;
  }
  async recent(o: LightTickOwner, since: string) {
    return structuredClone(
      [...this.tests.values()].filter(
        (t) => owner(t) === owner(o) && t.created_at >= since,
      ),
    );
  }
  async recoverable(now: string) {
    return structuredClone(
      [...this.tests.values()]
        .filter(
          (t) =>
            t.status === "queued" ||
            (t.status === "running" && t.lease_until! <= now),
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, 100),
    );
  }
  snapshot() {
    return structuredClone({
      settings: [...this.settings],
      tests: [...this.tests],
    });
  }
  restore(s: ReturnType<InMemoryPersonalModelStore["snapshot"]>) {
    this.settings = new Map(s.settings);
    this.tests = new Map(s.tests);
  }
  deleteOwner(o: LightTickOwner) {
    this.settings.delete(owner(o));
    for (const [k, t] of this.tests)
      if (owner(t) === owner(o)) this.tests.delete(k);
  }
}
