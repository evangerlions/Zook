import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { KnowledgeEntry, KnowledgeSource } from "./knowledge.types.ts";
import {
  digest,
  keys,
  object,
  text,
  integer,
  fail,
} from "../learning/native-learning.validation.ts";
export const knowledgeId = (id: unknown) => {
  const s = text(id, 90, true);
  if (!/^knowledge-[a-zA-Z0-9-]{1,75}$/.test(s))
    fail(422, "Invalid knowledge identity.");
  return s;
};
export async function sourceAvailable(
  repo: LightTickRepository,
  o: LightTickOwner,
  s: KnowledgeSource,
) {
  if (s.kind === "record") {
    const r = await repo.getRecord(o, s.id);
    return (
      !!r &&
      !r.payload.archived_at &&
      !!(await repo.getRecordVersion(o, s.id, Number(s.version)))
    );
  }
  const a = await repo.getLearningAuthority(o);
  if (a?.phase !== "zook" || !a.readingEnabled) return false;
  const l = await repo.getNativeLesson(o, s.id);
  return (
    !!l &&
    !l.archived &&
    !(await repo.getLearningCollection(o, l.collectionId))?.archived &&
    !!(await repo.getLessonPublication(o, s.id, s.version))
  );
}
export function knowledgeFields(b: Record<string, unknown>) {
  keys(b, ["base_revision", "kind", "title", "body", "tags", "sources"]);
  if (!["knowledge", "cognition"].includes(String(b.kind)))
    fail(422, "Select knowledge or cognition.");
  if (
    !Array.isArray(b.tags) ||
    b.tags.length > 20 ||
    !Array.isArray(b.sources) ||
    b.sources.length > 20
  )
    fail(422, "Knowledge tags and sources exceed capacity.");
  const tags = [...new Set(b.tags.map((t) => text(t, 50, true)))];
  const sources = b.sources.map((raw) => {
    const s = object(raw);
    keys(s, ["kind", "id", "version"]);
    const id = text(s.id, 128, true),
      v = text(s.version, 64, true);
    if (
      !(
        (s.kind === "record" &&
          /^[a-zA-Z0-9_-]{8,128}$/.test(id) &&
          /^[1-9][0-9]{0,9}$/.test(v) &&
          Number(v) <= 2147483647) ||
        (s.kind === "lesson" &&
          /^lesson-[a-z0-9-]+$/.test(id) &&
          /^[a-f0-9]{64}$/.test(v))
      )
    )
      fail(422, "Select an exact record or lesson version.");
    return { kind: s.kind, id, version: v } as KnowledgeSource;
  });
  if (new Set(sources.map((s) => digest(s))).size !== sources.length)
    fail(422, "Duplicate knowledge sources.");
  return {
    kind: b.kind as KnowledgeEntry["kind"],
    title: text(b.title, 500, true),
    body: text(b.body, 100000, true),
    tags,
    sources,
  };
}
export class KnowledgeService {
  constructor(
    readonly repo: LightTickRepository,
    readonly authorize: () => Promise<void> = async () => {},
    readonly clock = () => new Date(),
  ) {}
  async allowed(o: LightTickOwner, e: KnowledgeEntry) {
    for (const s of e.sources)
      if (!(await sourceAvailable(this.repo, o, s))) return false;
    return true;
  }
  async read(o: LightTickOwner, id: string) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const e = await this.repo.knowledge.get(o, knowledgeId(id));
      if (!e) fail(404, "Knowledge was not found.");
      if (!(await this.allowed(o, e)))
        fail(403, "A source grant was withdrawn; content is withheld.");
      return e;
    });
  }
  async history(
    o: LightTickOwner,
    id: string,
    before = 2147483647,
    limit = 20,
  ) {
    integer(before, 1, 2147483647);
    integer(limit, 1, 50);
    return this.repo.transaction(o, async () => {
      await this.read(o, id);
      const rows = await this.repo.knowledge.history(o, id, before, limit + 1),
        items = [];
      for (const row of rows.slice(0, limit))
        if (await this.allowed(o, row)) items.push(row);
      return {
        items,
        next_before: rows.length > limit ? rows[limit - 1].revision : null,
      };
    });
  }
  async mutate(
    o: LightTickOwner,
    id: string,
    action: "save" | "archive" | "restore",
    b: Record<string, unknown>,
    key: string,
  ) {
    knowledgeId(id);
    const base = integer(b.base_revision, 0, 2147483646);
    if (key.length < 8 || key.length > 128)
      fail(422, "An original request identity is required.");
    const fields = action === "save" ? knowledgeFields(b) : undefined;
    if (action !== "save") keys(b, ["base_revision"]);
    const hash = digest({ id, action, b });
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const old = await this.repo.knowledge.get(o, id);
      if (old && !(await this.allowed(o, old)))
        fail(403, "The source is unavailable; retain the local copy.");
      if (fields)
        for (const source of fields.sources)
          if (!(await sourceAvailable(this.repo, o, source)))
            fail(403, "The exact source is unavailable.");
      const receipt = await this.repo.getOperation(o, key);
      if (receipt) {
        if (
          receipt.entityType !== "knowledge" ||
          receipt.entityId !== id ||
          receipt.payloadHash !== hash
        )
          fail(409, "Request identity was used for another command.");
        const result = receipt.resultPayload as unknown as KnowledgeEntry;
        if (!(await this.allowed(o, result)))
          fail(403, "The original receipt source is no longer available.");
        return result;
      }
      if (
        (old?.revision ?? 0) !== base ||
        (!old && action !== "save") ||
        (old?.archived && action === "save") ||
        (action === "archive" && old?.archived) ||
        (action === "restore" && !old?.archived)
      )
        fail(409, "Knowledge changed; compare both copies.");
      const now = this.clock().toISOString(),
        entry: KnowledgeEntry = {
          ...(fields ?? old!),
          id,
          revision: base + 1,
          archived:
            action === "archive"
              ? true
              : action === "restore"
                ? false
                : (old?.archived ?? false),
          created_at: old?.created_at ?? now,
          updated_at: now,
        };
      await this.repo.knowledge.save(o, entry, base);
      await this.repo.saveOperation({
        ...o,
        operationId: key,
        deviceId: "knowledge-http",
        payloadHash: hash,
        entityType: "knowledge",
        entityId: id,
        action,
        requestPayload: b,
        resultPayload: entry as unknown as Record<string, unknown>,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return entry;
    });
  }
}
