import type { LightTickOwner } from "../lighttick.types.ts";
import type {
  LearningCollection,
  NativeLesson,
  LessonPublication,
  NativePrivateState,
  LearningHistoryEntry,
} from "./native-learning.types.ts";
import {
  answers,
  collectionIdentity,
  digest,
  fail,
  identity,
  integer,
  keys,
  object,
  text,
  version,
} from "./native-learning.validation.ts";
export interface LearningMigrationManifest {
  digest: string;
  source: {
    instance: string;
    account_id: string;
    binding_id: string;
    library_revision: number;
    private_revision: number;
    frozen_at: string;
    frozen: boolean;
  };
  reading: boolean;
  private: boolean;
  collections: LearningCollection[];
  lessons: NativeLesson[];
  publications: LessonPublication[];
  states: NativePrivateState[];
  history: LearningHistoryEntry[];
  receipts: {
    id: string;
    lesson_id: string;
    hash: string;
    status: "pending" | "applied" | "conflict" | "unavailable";
    error: string;
    body?: Record<string, unknown>;
    created_at: string | null;
  }[];
}
export function timestamp(v: unknown, nullable = false): string | null {
  if (nullable && v === null) return null;
  const s = text(v, 80, true);
  if (
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s) ||
    !Number.isFinite(Date.parse(s))
  )
    fail(422, "Invalid source timestamp.");
  return new Date(s).toISOString();
}
function bounded(v: unknown, max: number): any[] {
  if (!Array.isArray(v) || v.length > max)
    fail(422, "Migration array exceeds its declared capacity.");
  return v;
}
export function readLearningManifest(
  owner: LightTickOwner,
  input: unknown,
  expectedDigest: string,
  now: string,
): LearningMigrationManifest {
  const b = object(input);
  keys(b, [
    "format_version",
    "module",
    "mapping",
    "source",
    "consent",
    "collections",
    "lessons",
    "private_states",
    "private_history",
    "receipts",
  ]);
  if (b.format_version !== 1 || b.module !== "learning")
    fail(422, "Unsupported learning migration format.");
  if (Buffer.byteLength(JSON.stringify(b)) > 6 * 1024 * 1024)
    fail(413, "Migration bundle exceeds capacity.");
  if (digest(b) !== version(expectedDigest))
    fail(409, "The bundle differs from the explicitly reviewed digest.");
  const mapping = object(b.mapping);
  keys(mapping, [
    "target_user_id",
    "source_account_id",
    "source_instance",
    "verified",
  ]);
  if (mapping.target_user_id !== owner.userId || mapping.verified !== true)
    fail(
      403,
      "An explicit verified source-to-target owner mapping is required.",
    );
  const s = object(b.source);
  keys(s, [
    "instance",
    "account_id",
    "binding_id",
    "library_revision",
    "private_revision",
    "frozen",
    "frozen_at",
  ]);
  const source = {
    instance: text(s.instance, 200, true),
    account_id: text(s.account_id, 200, true),
    binding_id: text(s.binding_id, 200, true),
    library_revision: integer(s.library_revision, 0, 2147483647),
    private_revision: integer(s.private_revision, 0, 2147483647),
    frozen: s.frozen === true,
    frozen_at: timestamp(s.frozen_at)!,
  };
  if (
    !source.frozen ||
    Date.parse(source.frozen_at) > Date.parse(now) + 120000 ||
    mapping.source_account_id !== source.account_id ||
    mapping.source_instance !== source.instance
  )
    fail(409, "The sealed source freeze and identity proof do not match.");
  const consent = object(b.consent);
  keys(consent, ["reading", "private"]);
  if (
    typeof consent.reading !== "boolean" ||
    typeof consent.private !== "boolean" ||
    (consent.private && !consent.reading)
  )
    fail(422, "Source reading and private consent must remain separate.");
  const collections = bounded(b.collections, 200).map((raw) => {
    const x = object(raw);
    keys(x, ["id", "title", "archived"]);
    if (typeof x.archived !== "boolean")
      fail(422, "Archive state is required.");
    return {
      ...owner,
      id: collectionIdentity(x.id),
      title: text(x.title, 500, true),
      archived: x.archived,
      revision: 1,
      updatedAt: source.frozen_at,
    } as LearningCollection;
  });
  const lessons: NativeLesson[] = [],
    publications: LessonPublication[] = [];
  const ordinals = new Set<string>();
  for (const raw of bounded(b.lessons, 200)) {
    const x = object(raw);
    keys(x, [
      "id",
      "collection_id",
      "number",
      "title",
      "content_version",
      "learning_state",
      "publications",
    ]);
    const id = identity(x.id, "lesson-"),
      collectionId = collectionIdentity(x.collection_id),
      number = integer(x.number, 1, 100000),
      publishedVersion = version(x.content_version);
    if (
      !collections.some((c) => c.id === collectionId) ||
      !["unknown", "completed"].includes(x.learning_state)
    )
      fail(422, "Lesson relationship or source completion is invalid.");
    const ordinal = JSON.stringify([collectionId, number]);
    if (ordinals.has(ordinal)) fail(422, "Duplicate lesson ordinal.");
    ordinals.add(ordinal);
    lessons.push({
      ...owner,
      id,
      collectionId,
      number,
      title: text(x.title, 500, true),
      revision: 1,
      publishedVersion,
      sourceCompleted: x.learning_state === "completed",
      archived: false,
      updatedAt: source.frozen_at,
    });
    for (const rawVersion of bounded(x.publications, 100)) {
      const p = object(rawVersion);
      keys(p, ["content_version", "content", "references", "source_url"]);
      const content = text(p.content, 100000, true),
        references = text(p.references, 100000),
        contentVersion = version(p.content_version),
        sourceUrl = text(p.source_url, 1500);
      if (digest({ content, references }) !== contentVersion)
        fail(409, "A published body differs from its stable version digest.");
      if (sourceUrl) {
        let u: URL;
        try {
          u = new URL(sourceUrl);
        } catch {
          fail(422, "Invalid source URL.");
        }
        if (
          u!.username ||
          u!.password ||
          u!.search ||
          u!.hash ||
          (u!.protocol !== "https:" &&
            !(
              u!.protocol === "http:" &&
              ["localhost", "127.0.0.1"].includes(u!.hostname)
            ))
        )
          fail(422, "Unsafe source URL.");
      }
      publications.push({
        ...owner,
        lessonId: id,
        contentVersion,
        content,
        references,
        sourceUrl,
        createdAt: now,
      });
    }
    if (
      !publications.some(
        (p) => p.lessonId === id && p.contentVersion === publishedVersion,
      )
    )
      fail(422, "Current publication is absent.");
  }
  const parseState = (raw: unknown): NativePrivateState => {
    const x = object(raw);
    keys(x, [
      "lesson_id",
      "content_version",
      "draft_version",
      "revision",
      "notes",
      "answers",
      "position",
      "completed",
      "completed_at",
      "updated_at",
    ]);
    const lessonId = identity(x.lesson_id, "lesson-"),
      contentVersion = version(x.content_version),
      revision = integer(x.revision, 1, 2147483646);
    if (
      !publications.some(
        (p) => p.lessonId === lessonId && p.contentVersion === contentVersion,
      ) ||
      typeof x.completed !== "boolean"
    )
      fail(422, "Private state references an absent publication.");
    return {
      ...owner,
      lessonId,
      contentVersion,
      draftVersion: version(x.draft_version),
      revision,
      notesRevision: revision,
      positionRevision: revision,
      completionRevision: revision,
      notes: text(x.notes, 10000),
      answers: answers(x.answers),
      position: integer(x.position, 0, 100000),
      completed: x.completed,
      completedAt: timestamp(x.completed_at, true),
      updatedAt: timestamp(x.updated_at)!,
    };
  };
  const states = bounded(b.private_states, 2000).map(parseState),
    history = bounded(b.private_history, 10000).map((raw) => {
      const state = parseState(raw);
      return {
        ...owner,
        id:
          "migration-" +
          digest([state.lessonId, state.contentVersion, state.revision]).slice(
            0,
            48,
          ),
        lessonId: state.lessonId,
        contentVersion: state.contentVersion,
        revision: state.revision,
        component: "import" as const,
        state,
        createdAt: state.updatedAt,
      };
    });
  const receipts = bounded(b.receipts, 1000).map((raw) => {
    const x = object(raw);
    keys(x, [
      "id",
      "lesson_id",
      "hash",
      "status",
      "error",
      "body",
      "created_at",
    ]);
    const id = identity(x.id),
      lesson_id = identity(x.lesson_id, "lesson-"),
      hash = version(x.hash);
    if (
      !lessons.some((l) => l.id === lesson_id) ||
      !["pending", "applied", "conflict", "unavailable"].includes(x.status)
    )
      fail(422, "Invalid migration receipt.");
    let body: Record<string, unknown> | undefined;
    if (x.body !== undefined) {
      const p = object(x.body);
      keys(p, [
        "id",
        "lesson_id",
        "content_version",
        "revision",
        "action",
        "notes",
        "answers",
        "position",
      ]);
      if (
        p.id !== id ||
        p.lesson_id !== lesson_id ||
        !["save", "complete", "position"].includes(p.action)
      )
        fail(422, "Pending operation identity changed.");
      body = {
        id,
        lesson_id,
        content_version: version(p.content_version),
        revision: integer(p.revision, 1, 2147483647),
        action: p.action,
        notes: text(p.notes, 10000),
        answers: answers(p.answers),
        position: integer(p.position, 0, 100000),
      };
      if (digest(body) !== hash)
        fail(409, "An original private request hash changed.");
    }
    if (x.status === "pending" && !body)
      fail(
        409,
        "An unresolved command needs its original body; do not guess its outcome.",
      );
    return {
      id,
      lesson_id,
      hash,
      status:
        x.status as LearningMigrationManifest["receipts"][number]["status"],
      error: text(x.error, 500),
      body,
      created_at: timestamp(x.created_at, true),
    };
  });
  const unique = (values: string[]) => {
    if (new Set(values).size !== values.length)
      fail(422, "Duplicate migration identity.");
  };
  unique(collections.map((c) => c.id));
  unique(lessons.map((l) => l.id));
  unique(
    publications.map((p) => JSON.stringify([p.lessonId, p.contentVersion])),
  );
  unique(states.map((p) => JSON.stringify([p.lessonId, p.contentVersion])));
  unique(history.map((h) => h.id));
  unique(receipts.map((r) => r.id));
  for (const h of history) {
    const current = states.find(
      (s) => s.lessonId === h.lessonId && s.contentVersion === h.contentVersion,
    );
    if (
      !current ||
      h.revision > current.revision ||
      (h.revision === current.revision && digest(h.state) !== digest(current))
    )
      fail(409, "Private history conflicts with its latest snapshot.");
  }
  if (
    (!consent.reading && (collections.length || lessons.length)) ||
    (!consent.private && (states.length || history.length || receipts.length))
  )
    fail(403, "Migration would expand source consent.");
  return {
    digest: expectedDigest,
    source,
    reading: consent.reading,
    private: consent.private,
    collections,
    lessons,
    publications,
    states,
    history,
    receipts,
  };
}
