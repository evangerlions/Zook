import { NativePrivateLearning } from "./native-learning.private.ts";
import { NativeLearningCompatibility } from "./native-learning.compatibility.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type {
  LearningAuthority,
  NativeLesson,
} from "./native-learning.types.ts";
import { createHmac } from "node:crypto";
import {
  digest,
  integer,
  identity,
  collectionIdentity,
  keys,
  text,
  version,
  fail,
  privateData,
} from "./native-learning.validation.ts";
import { ApplicationError } from "../../../shared/errors.ts";
export class NativeLearningService {
  private readonly privateLearning = new NativePrivateLearning(this);
  privateState(owner: LightTickOwner, id: string, v: string) {
    return this.privateLearning.privateState(owner, id, v);
  }
  privateCommand(
    owner: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
    authorize?: () => Promise<void>,
    compat = false,
  ) {
    return this.privateLearning.privateCommand(
      owner,
      id,
      b,
      key,
      authorize,
      compat,
    );
  }

  private readonly compatibility = new NativeLearningCompatibility(this);
  legacy(
    owner: LightTickOwner,
    id?: string,
    b?: Record<string, unknown>,
    authorize?: () => Promise<void>,
  ) {
    return this.compatibility.legacy(owner, id, b, authorize);
  }
  legacyPrivate(owner: LightTickOwner, id: string) {
    return this.compatibility.legacyPrivate(owner, id);
  }

  constructor(
    readonly repository: LightTickRepository,
    readonly enabled = false,
    readonly clock = () => new Date(),
    private readonly cursorSecret = "native-learning-cursor-v1",
  ) {}
  private cursor(
    o: LightTickOwner,
    scope: string,
    position: string,
    revision?: number,
  ) {
    const raw = JSON.stringify({
        owner: [o.appId, o.userId],
        scope,
        position,
        revision,
      }),
      signature = createHmac("sha256", this.cursorSecret)
        .update(raw)
        .digest("hex");
    return Buffer.from(JSON.stringify({ raw, signature })).toString(
      "base64url",
    );
  }
  private position(
    o: LightTickOwner,
    scope: string,
    cursor: string,
    revision?: number,
  ) {
    if (!cursor) return "";
    try {
      if (cursor.length > 2048) throw Error();
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString()),
        v = JSON.parse(decoded.raw);
      if (
        decoded.signature !==
          createHmac("sha256", this.cursorSecret)
            .update(decoded.raw)
            .digest("hex") ||
        v.owner[0] !== o.appId ||
        v.owner[1] !== o.userId ||
        v.scope !== scope ||
        typeof v.position !== "string"
      )
        throw Error();
      if (revision !== undefined && v.revision !== revision)
        fail(
          409,
          "The learning catalog changed; restart its projection without deleting drafts.",
        );
      return v.position as string;
    } catch (error) {
      if (error instanceof ApplicationError && error.statusCode === 409)
        throw error;
      fail(
        400,
        "The learning cursor is invalid or belongs to another owner or query.",
      );
    }
  }
  async authority(owner: LightTickOwner) {
    return this.repository.transaction(owner, async () => {
      let row = await this.repository.getLearningAuthority(owner);
      if (!row && this.enabled) {
        const legacy = await this.repository.getLearningLibrary(owner),
          privateLegacy = await this.repository.getLearningPrivate(owner),
          sourceLink = await this.repository.getOwnerActionLink(owner),
          historical = !!(legacy || privateLegacy || sourceLink);
        row = {
          ...owner,
          module: "learning",
          readingEnabled: historical ? legacy?.consent_enabled === true : true,
          privateEnabled: historical ? privateLegacy?.enabled === true : true,
          phase: historical ? "legacy" : "zook",
          epoch: historical ? 0 : 1,
          revision: 1,
          manifestHash: null,
          sourceBinding:
            legacy?.binding_id ??
            privateLegacy?.binding_id ??
            sourceLink?.binding_id ??
            null,
          updatedAt: this.clock().toISOString(),
        };
        await this.repository.saveLearningAuthority(row, 0);
      }
      return row;
    });
  }
  async assertLegacyWrite(owner: LightTickOwner) {
    const authority = await this.repository.getLearningAuthority(owner);
    if (authority && authority.phase !== "legacy")
      fail(
        409,
        "The learning source is frozen or replaced; the old writer cannot publish.",
      );
  }
  async requireActive(owner: LightTickOwner) {
    const a = await this.authority(owner);
    if (!a) fail(503, "Native learning is not enabled.");
    if (a.phase !== "zook")
      fail(
        409,
        "Learning authority requires a verified migration before native writes.",
      );
    return a;
  }
  async command<T>(
    owner: LightTickOwner,
    key: string,
    kind: string,
    id: string,
    body: Record<string, unknown>,
    perform: (authority: LearningAuthority) => Promise<T>,
    authorize: () => Promise<void> = async () => {},
    compat = false,
  ) {
    identity(key);
    const hash = digest(
        compat ? { ...body, lesson_id: id } : { kind, id, body },
      ),
      operationId = (compat ? "learning-compat:" : "learning:") + key;
    return this.repository.transaction(owner, async () => {
      await authorize();
      if (kind !== "consent") {
        const access = await this.authority(owner);
        if (
          !access?.readingEnabled ||
          (kind.startsWith("private:") && !access.privateEnabled)
        )
          fail(403, "Learning consent is required.");
      }
      const old = await this.repository.getOperation(owner, operationId);
      if (old) {
        if (
          old.payloadHash !== hash ||
          old.entityId !== id ||
          (old.action !== kind && !(compat && old.action === "private:legacy"))
        )
          throw new ApplicationError(
            409,
            "LIGHTTICK_IDEMPOTENCY_MISMATCH",
            "Learning key belongs to another immutable request.",
          );
        return old.resultPayload as T;
      }
      if (!this.enabled)
        fail(
          503,
          "New learning writes are disabled; history and accepted receipts remain readable.",
        );
      const authority = await this.requireActive(owner),
        result = await perform(authority),
        now = this.clock().toISOString();
      if (!kind.startsWith("private:") && kind !== "consent")
        await this.repository.saveLearningAuthority(
          { ...authority, revision: authority.revision + 1, updatedAt: now },
          authority.revision,
        );
      await this.repository.saveOperation({
        ...owner,
        operationId,
        deviceId: "native-learning",
        entityType: kind.startsWith("private:")
          ? "learning_private"
          : "learning_catalog",
        entityId: id,
        action: kind,
        payloadHash: hash,
        requestPayload: body,
        resultPayload: result as Record<string, unknown>,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return result;
    });
  }
  async collections(owner: LightTickOwner, after = "", limit = 50) {
    return this.repository.transaction(owner, async () => {
      const authority = await this.requireActive(owner);
      if (!authority.readingEnabled) fail(403, "Reading consent is required.");
      integer(limit, 1, 100);
      const rows = await this.repository.listLearningCollections(
        owner,
        this.position(owner, "collections", after, authority.revision),
        limit + 1,
      );
      return {
        items: rows.slice(0, limit).map((r) => ({
          id: r.id,
          title: r.title,
          revision: r.revision,
          archived: r.archived,
          updated_at: r.updatedAt,
        })),
        next_cursor:
          rows.length > limit
            ? this.cursor(
                owner,
                "collections",
                rows[limit - 1].id,
                authority.revision,
              )
            : null,
      };
    });
  }
  async lessons(
    owner: LightTickOwner,
    after = "",
    limit = 50,
    collectionId?: string,
  ) {
    return this.repository.transaction(owner, async () => {
      const authority = await this.requireActive(owner);
      if (!authority.readingEnabled) fail(403, "Reading consent is required.");
      integer(limit, 1, 100);
      const scope = "lessons:" + (collectionId ?? ""),
        rows = await this.repository.listNativeLessons(
          owner,
          this.position(owner, scope, after, authority.revision),
          limit + 1,
          collectionId,
        );
      return {
        items: rows.slice(0, limit).map((r) => this.lessonData(r)),
        next_cursor:
          rows.length > limit
            ? this.cursor(owner, scope, rows[limit - 1].id, authority.revision)
            : null,
      };
    });
  }
  lessonData(r: NativeLesson) {
    return {
      id: r.id,
      collection_id: r.collectionId,
      number: r.number,
      title: r.title,
      revision: r.revision,
      published_version: r.publishedVersion,
      archived: r.archived,
      updated_at: r.updatedAt,
    };
  }
  async saveCollection(
    owner: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
    authorize?: () => Promise<void>,
  ) {
    collectionIdentity(id);
    keys(b, ["base_revision", "title", "archived"]);
    const base = integer(b.base_revision, 0, 2147483646),
      title = text(b.title, 500, true);
    if (typeof b.archived !== "boolean")
      fail(422, "Archive state must be explicit.");
    return this.command(
      owner,
      key,
      "collection",
      id,
      b,
      async () => {
        const now = this.clock().toISOString();
        await this.repository.saveLearningCollection(
          {
            ...owner,
            id,
            title,
            archived: b.archived as boolean,
            revision: base + 1,
            updatedAt: now,
          },
          base,
        );
        return {
          id,
          title,
          archived: b.archived,
          revision: base + 1,
          updated_at: now,
        };
      },
      authorize,
    );
  }
  async publish(
    owner: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
    authorize?: () => Promise<void>,
  ) {
    identity(id, "lesson-");
    keys(b, [
      "base_revision",
      "collection_id",
      "number",
      "title",
      "content",
      "references",
      "source_url",
    ]);
    const base = integer(b.base_revision, 0, 2147483646),
      collectionId = collectionIdentity(b.collection_id),
      number = integer(b.number, 1, 100000),
      title = text(b.title, 500, true),
      content = text(b.content, 100000, true),
      references = text(b.references, 100000),
      sourceUrl = text(b.source_url ?? "", 1500),
      contentVersion = digest({ content, references });
    if (sourceUrl) {
      let url: URL;
      try {
        url = new URL(sourceUrl);
      } catch {
        fail(422, "Invalid source URL.");
      }
      if (url!.protocol !== "https:" || url!.username || url!.password)
        fail(422, "Source URLs must be HTTPS without credentials.");
    }
    return this.command(
      owner,
      key,
      "publish",
      id,
      b,
      async () => {
        const collection = await this.repository.getLearningCollection(
          owner,
          collectionId,
        );
        if (!collection || collection.archived)
          fail(404, "Collection is unavailable.");
        const old = await this.repository.getNativeLesson(owner, id);
        if (old && (old.collectionId !== collectionId || old.number !== number))
          fail(
            409,
            "A published lesson keeps its collection and ordinal identity.",
          );
        const now = this.clock().toISOString();
        const row: NativeLesson = {
          ...owner,
          id,
          collectionId,
          number,
          title,
          revision: base + 1,
          publishedVersion: contentVersion,
          archived: false,
          updatedAt: now,
        };
        await this.repository.saveNativeLesson(row, base);
        await this.repository.insertLessonPublication({
          ...owner,
          lessonId: id,
          contentVersion,
          content,
          references,
          sourceUrl,
          createdAt: now,
        });
        return { ...this.lessonData(row), content_version: contentVersion };
      },
      authorize,
    );
  }
  async publication(owner: LightTickOwner, id: string, v?: string) {
    return this.repository.transaction(owner, async () => {
      const a = await this.requireActive(owner);
      if (!a.readingEnabled) fail(403, "Reading consent is required.");
      const lesson = await this.repository.getNativeLesson(owner, id);
      if (!lesson || lesson.archived || !lesson.publishedVersion)
        fail(404, "Published lesson is unavailable.");
      const collection = await this.repository.getLearningCollection(
        owner,
        lesson.collectionId,
      );
      if (!collection || collection.archived)
        fail(404, "Collection is unavailable.");
      const publication = await this.repository.getLessonPublication(
        owner,
        id,
        v ?? lesson.publishedVersion,
      );
      if (!publication) fail(404, "Content version is unavailable.");
      return { lesson, collection, publication };
    });
  }

  async consent(
    owner: LightTickOwner,
    b: Record<string, unknown>,
    key: string,
    authorize?: () => Promise<void>,
  ) {
    keys(b, ["base_revision", "reading_enabled", "private_enabled"]);
    if (
      typeof b.reading_enabled !== "boolean" ||
      typeof b.private_enabled !== "boolean" ||
      (b.private_enabled && !b.reading_enabled)
    )
      fail(422, "Confirm reading and private consent separately.");
    return this.command(
      owner,
      key,
      "consent",
      "learning",
      b,
      async (a) => {
        if (integer(b.base_revision, 1, 2147483647) !== a.revision)
          fail(409, "Learning consent changed.");
        await this.repository.saveLearningAuthority(
          {
            ...a,
            readingEnabled: b.reading_enabled as boolean,
            privateEnabled: b.private_enabled as boolean,
            revision: a.revision + 1,
            updatedAt: this.clock().toISOString(),
          },
          a.revision,
        );
        return {
          reading_enabled: b.reading_enabled,
          private_enabled: b.private_enabled,
          revision: a.revision + 1,
        };
      },
      authorize,
    );
  }
  async history(
    owner: LightTickOwner,
    id: string,
    v: string,
    cursor = "",
    limit = 20,
  ) {
    return this.repository.transaction(owner, async () => {
      version(v);
      integer(limit, 1, 20);
      const access = await this.requireActive(owner);
      if (!access.privateEnabled)
        fail(403, "Private learning consent is required.");
      await this.publication(owner, id, v);
      const scope = "private-history:" + id + ":" + v,
        before = this.position(owner, scope, cursor);
      if (before && !/^[1-9][0-9]*$/.test(before))
        fail(400, "Invalid history cursor.");
      const rows = await this.repository.listLearningHistory(
        owner,
        id,
        v,
        before,
        limit + 1,
      );
      return {
        items: rows.slice(0, limit).map((x) => ({
          id: x.id,
          component: x.component,
          revision: x.revision,
          state: privateData(x.state),
          created_at: x.createdAt,
        })),
        next_cursor:
          rows.length > limit
            ? this.cursor(owner, scope, String(rows[limit - 1].revision))
            : null,
      };
    });
  }
}
