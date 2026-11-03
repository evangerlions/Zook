import type { NativeLearningService } from "./native-learning.service.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { NativeLesson } from "./native-learning.types.ts";
import { identity, fail, legacyState } from "./native-learning.validation.ts";
import { learningQuestions } from "./learning-questions.ts";
import { ApplicationError } from "../../../shared/errors.ts";
export class NativeLearningCompatibility {
  constructor(private readonly learning: NativeLearningService) {}
  async legacy(
    owner: LightTickOwner,
    id?: string,
    b?: Record<string, unknown>,
    authorize?: () => Promise<void>,
  ) {
    return this.learning.repository.transaction(owner, async () => {
      const authority =
        await this.learning.repository.getLearningAuthority(owner);
      if (authority?.phase !== "zook") {
        if (b) await this.learning.assertLegacyWrite(owner);
        return undefined;
      }
      if (!authority.readingEnabled) {
        if (b) fail(403, "Reading consent is required.");
        if (id) fail(404, "Published lesson is unavailable.");
        return {
          consent_enabled: false,
          binding_id: null,
          observed_at: null,
          lessons: [],
        };
      }
      if (id && b)
        await this.learning.privateCommand(
          owner,
          id,
          b,
          identity(b.id),
          authorize,
          true,
        );
      if (id && b !== undefined) return this.legacyPrivate(owner, id);
      if (id) {
        const { lesson, collection, publication } =
          await this.learning.publication(owner, id);
        return {
          lesson: await this.legacyLesson(
            owner,
            lesson,
            collection.title,
            publication,
          ),
          observed_at: lesson.updatedAt,
          binding_id: authority.sourceBinding ?? "native-learning",
        };
      }
      const rows = await this.learning.repository.listNativeLessons(
        owner,
        "",
        201,
      );
      if (rows.length > 200)
        fail(409, "This library requires the paginated learning client.");
      const lessons = [];
      for (const row of rows)
        if (!row.archived && row.publishedVersion) {
          try {
            const { collection, publication } = await this.learning.publication(
              owner,
              row.id,
            );
            const { content, references, ...summary } = await this.legacyLesson(
              owner,
              row,
              collection.title,
              publication,
            );
            lessons.push(summary);
          } catch (e) {
            if (!(e instanceof ApplicationError) || e.statusCode !== 404)
              throw e;
          }
        }
      return {
        consent_enabled: true,
        binding_id: authority.sourceBinding ?? "native-learning",
        observed_at: authority.updatedAt,
        lessons,
      };
    });
  }
  private async legacyLesson(
    owner: LightTickOwner,
    row: NativeLesson,
    collectionTitle: string,
    p: {
      contentVersion: string;
      content: string;
      references: string;
      sourceUrl: string;
    },
  ) {
    const state = await this.learning.repository.getNativePrivateState(
      owner,
      row.id,
      p.contentVersion,
    );
    return {
      id: row.id,
      collection_id: row.collectionId,
      collection_title: collectionTitle,
      number: row.number,
      title: row.title,
      content_version: p.contentVersion,
      content: p.content,
      references: p.references,
      source_url: p.sourceUrl,
      learning_state:
        state?.completed || row.sourceCompleted ? "completed" : "unknown",
    };
  }
  async legacyPrivate(owner: LightTickOwner, id: string) {
    return this.learning.repository.transaction(owner, async () => {
      const a = await this.learning.requireActive(owner);
      if (!a.readingEnabled || !a.privateEnabled)
        return { enabled: false, state: null, operations: [] };
      const { publication } = await this.learning.publication(owner, id),
        state = await this.learning.privateState(
          owner,
          id,
          publication.contentVersion,
        ),
        receipts = await this.learning.repository.listLearningReceipts(
          owner,
          id,
        );
      return {
        enabled: true,
        state: legacyState(state, learningQuestions(publication.content)),
        operations: receipts.map((r) => ({
          id: r.operationId.slice("learning-compat:".length),
          status:
            r.status === "accepted"
              ? "applied"
              : r.status === "conflict"
                ? "conflict"
                : "unavailable",
          error: String(r.resultPayload.error ?? ""),
        })),
      };
    });
  }
}
