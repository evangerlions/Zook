import type { LightTickOwner } from "../lighttick.types.ts";
import type {
  NativePrivateState,
  LearningHistoryEntry,
  LearningAuthority,
} from "./native-learning.types.ts";
import { NativeLearningService } from "./native-learning.service.ts";
import {
  readLearningManifest,
  type LearningMigrationManifest,
} from "./learning-migration.manifest.ts";
import {
  digest,
  fail,
  identity,
  integer,
  privateData,
} from "./native-learning.validation.ts";
import { ApplicationError } from "../../../shared/errors.ts";
export type LearningMigrationAction =
  | "freeze"
  | "import"
  | "verify"
  | "activate"
  | "abort";
export class LearningMigrationService {
  constructor(readonly learning: NativeLearningService) {}
  private get repo() {
    return this.learning.repository;
  }
  private resolve(m: LearningMigrationManifest) {
    const states = structuredClone(m.states),
      history = structuredClone(m.history),
      receipts = structuredClone(m.receipts);
    const retain = (state: NativePrivateState) => {
      if (
        !history.some(
          (h) =>
            h.lessonId === state.lessonId &&
            h.contentVersion === state.contentVersion &&
            h.revision === state.revision,
        )
      )
        history.push({
          appId: state.appId,
          userId: state.userId,
          lessonId: state.lessonId,
          contentVersion: state.contentVersion,
          revision: state.revision,
          id:
            "migration-" +
            digest([
              state.lessonId,
              state.contentVersion,
              state.revision,
            ]).slice(0, 48),
          component: "import",
          state: structuredClone(state),
          createdAt: state.updatedAt,
        } as LearningHistoryEntry);
    };
    states.forEach(retain);
    for (const receipt of receipts)
      if (receipt.status === "pending") {
        const b = receipt.body!,
          state = states.find(
            (s) =>
              s.lessonId === receipt.lesson_id &&
              s.contentVersion === b.content_version,
          ),
          lesson = m.lessons.find((l) => l.id === receipt.lesson_id);
        if (
          !state ||
          state.revision !== b.revision ||
          lesson?.publishedVersion !== b.content_version
        ) {
          receipt.status = "conflict";
          receipt.error =
            "The original private base or publication changed; compare the retained input.";
          continue;
        }
        state.revision++;
        state.updatedAt = m.source.frozen_at;
        if (b.action === "save") {
          state.notes = String(b.notes);
          state.answers = structuredClone(
            b.answers,
          ) as NativePrivateState["answers"];
          state.notesRevision++;
        } else if (b.action === "position") {
          state.position = Number(b.position);
          state.positionRevision++;
        } else {
          state.completed = true;
          state.completedAt = state.completedAt ?? receipt.created_at;
          state.completionRevision++;
        }
        retain(state);
        receipt.status = "applied";
        receipt.error = "";
      }
    return {
      states,
      history,
      receipts,
      counts: {
        collections: m.collections.length,
        lessons: m.lessons.length,
        publications: m.publications.length,
        states: states.length,
        history: history.length,
        receipts: receipts.length,
      },
    };
  }
  private async sourceMatches(
    owner: LightTickOwner,
    m: LearningMigrationManifest,
  ) {
    const library = await this.repo.getLearningLibrary(owner),
      privateState = await this.repo.getLearningPrivate(owner),
      link = await this.repo.getOwnerActionLink(owner);
    if (
      link &&
      (link.source_account_id !== m.source.account_id ||
        link.binding_id !== m.source.binding_id)
    )
      fail(409, "The reviewed source binding does not own this target.");
    if (
      library &&
      (library.binding_id !== m.source.binding_id ||
        library.source_revision !== m.source.library_revision ||
        library.consent_enabled !== m.reading)
    )
      fail(409, "The legacy reading watermark or consent changed.");
    if (
      privateState &&
      (privateState.binding_id !== m.source.binding_id ||
        privateState.source_revision !== m.source.private_revision ||
        privateState.enabled !== m.private)
    )
      fail(409, "The legacy private watermark or consent changed.");
  }
  async preflight(
    owner: LightTickOwner,
    bundle: unknown,
    expectedDigest: string,
  ) {
    const m = readLearningManifest(
      owner,
      bundle,
      expectedDigest,
      this.learning.clock().toISOString(),
    );
    return this.repo.transaction(owner, async () => {
      await this.sourceMatches(owner, m);
      const authority = await this.repo.getLearningAuthority(owner),
        counts = await this.repo.getNativeLearningCounts(owner);
      if (
        (!authority ||
          authority.phase === "legacy" ||
          (authority.phase === "zook" && authority.revision === 1)) &&
        Object.values(counts).some((n) => n !== 0)
      )
        fail(
          409,
          "Target native data already exists; do not overwrite or merge accounts.",
        );
      const resolved = this.resolve(m);
      return {
        manifest_hash: m.digest,
        source_instance: m.source.instance,
        source_account_id: m.source.account_id,
        target_user_id: owner.userId,
        source_binding: m.source.binding_id,
        phase: authority?.phase ?? "uninitialized",
        epoch: authority?.epoch ?? 0,
        counts: resolved.counts,
        pending_resolutions: resolved.receipts
          .filter(
            (r) =>
              m.receipts.find((old) => old.id === r.id)?.status === "pending",
          )
          .map((r) => ({ id: r.id, status: r.status })),
        external_source_freeze_attested: true,
      };
    });
  }
  async command(
    owner: LightTickOwner,
    action: LearningMigrationAction,
    bundle: unknown,
    expectedDigest: string,
    baseRevision: number,
    key: string,
    authorize: () => Promise<void> = async () => {},
  ) {
    identity(key);
    integer(baseRevision, 0, 2147483646);
    const m = readLearningManifest(
        owner,
        bundle,
        expectedDigest,
        this.learning.clock().toISOString(),
      ),
      hash = digest({
        action,
        owner,
        manifest_hash: expectedDigest,
        base_revision: baseRevision,
      }),
      operationId = "learning-migration:" + key;
    return this.repo.transaction(owner, async () => {
      await authorize();
      const old = await this.repo.getOperation(owner, operationId);
      if (old) {
        if (old.payloadHash !== hash)
          throw new ApplicationError(
            409,
            "LIGHTTICK_IDEMPOTENCY_MISMATCH",
            "Migration key belongs to another reviewed command.",
          );
        return old.resultPayload;
      }
      if (!this.learning.enabled && action !== "abort")
        fail(503, "Native learning migration is not enabled.");
      await this.sourceMatches(owner, m);
      let a = await this.repo.getLearningAuthority(owner);
      if ((a?.revision ?? 0) !== baseRevision)
        fail(409, "Authority revision changed.");
      const now = this.learning.clock().toISOString();
      if (action === "freeze") {
        if (
          (a && !["legacy", "zook"].includes(a.phase)) ||
          (a?.phase === "zook" && a.revision !== 1)
        )
          fail(409, "Authority cannot be frozen from this state.");
        const counts = await this.repo.getNativeLearningCounts(owner);
        if (Object.values(counts).some((n) => n !== 0))
          fail(409, "Target native learning data is not empty.");
        a = {
          ...owner,
          module: "learning",
          phase: "frozen",
          epoch: (a?.epoch ?? 0) + 1,
          revision: baseRevision + 1,
          manifestHash: m.digest,
          sourceBinding: m.source.binding_id,
          readingEnabled: m.reading,
          privateEnabled: m.private,
          updatedAt: now,
        };
        await this.repo.saveLearningAuthority(a, baseRevision);
      } else {
        if (
          !a ||
          a.manifestHash !== m.digest ||
          a.sourceBinding !== m.source.binding_id
        )
          fail(409, "The bundle is not the frozen migration.");
        const resolved = this.resolve(m);
        if (action === "import") {
          if (a.phase !== "frozen")
            fail(409, "Import requires frozen authority.");
          const counts = await this.repo.getNativeLearningCounts(owner);
          if (Object.values(counts).some((n) => n !== 0))
            fail(409, "Staging data is not empty.");
          for (const row of m.collections)
            await this.repo.saveLearningCollection(row, 0);
          for (const row of m.lessons) await this.repo.saveNativeLesson(row, 0);
          for (const row of m.publications)
            await this.repo.insertLessonPublication(row);
          for (const row of resolved.states)
            await this.repo.saveNativePrivateState(row, 0);
          for (const row of resolved.history)
            await this.repo.appendLearningHistory(row);
          for (const receipt of resolved.receipts) {
            const id = "learning-compat:" + receipt.id;
            if (await this.repo.getOperation(owner, id))
              fail(409, "A target receipt identity already exists.");
            await this.repo.saveOperation({
              ...owner,
              operationId: id,
              deviceId: "learning-migration",
              entityType: "learning_private",
              entityId: receipt.lesson_id,
              action: receipt.body
                ? "private:" + String(receipt.body.action)
                : "private:legacy",
              payloadHash: receipt.hash,
              requestPayload: receipt.body ?? {},
              resultPayload: {
                status: receipt.status,
                error: receipt.error,
                source_created_at: receipt.created_at,
                original_body:
                  receipt.status === "conflict" ? (receipt.body ?? null) : null,
              },
              status:
                receipt.status === "applied"
                  ? "accepted"
                  : receipt.status === "conflict"
                    ? "conflict"
                    : "rejected",
              createdAt: now,
              updatedAt: now,
            });
          }
          a = {
            ...a,
            phase: "imported",
            revision: a.revision + 1,
            updatedAt: now,
          };
        } else if (action === "verify") {
          if (a.phase !== "imported")
            fail(409, "Verification requires imported authority.");
          await this.verify(owner, m, resolved);
          a = {
            ...a,
            phase: "verified",
            revision: a.revision + 1,
            updatedAt: now,
          };
        } else if (action === "activate") {
          if (a.phase !== "verified")
            fail(409, "Activation requires a verified manifest.");
          await this.verify(owner, m, resolved);
          a = {
            ...a,
            phase: "zook",
            epoch: a.epoch + 1,
            revision: a.revision + 1,
            updatedAt: now,
          };
        } else if (action === "abort") {
          if (a.phase === "zook" || a.phase === "legacy")
            fail(
              409,
              "Active native authority cannot return to the old writer; export or compensate instead.",
            );
          await this.repo.clearNativeLearningStaging(owner);
          a = {
            ...a,
            phase: "legacy",
            epoch: a.epoch + 1,
            revision: a.revision + 1,
            manifestHash: null,
            updatedAt: now,
          };
        } else fail(422, "Unsupported migration action.");
        await this.repo.saveLearningAuthority(a, baseRevision);
      }
      const result = {
        phase: a.phase,
        epoch: a.epoch,
        revision: a.revision,
        manifest_hash: a.manifestHash,
      };
      await this.repo.saveOperation({
        ...owner,
        operationId,
        deviceId: "learning-migration-control",
        entityType: "learning_authority",
        entityId: "learning",
        action,
        payloadHash: hash,
        requestPayload: {
          manifest_hash: m.digest,
          base_revision: baseRevision,
        },
        resultPayload: result,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return result;
    });
  }
  private async verify(
    owner: LightTickOwner,
    m: LearningMigrationManifest,
    resolved: ReturnType<LearningMigrationService["resolve"]>,
  ) {
    const actual = await this.repo.getNativeLearningCounts(owner);
    for (const [name, count] of Object.entries(resolved.counts))
      if (name !== "receipts" && actual[name] !== count)
        fail(409, "Migration count mismatch: " + name);
    for (const expected of m.collections)
      if (
        digest(await this.repo.getLearningCollection(owner, expected.id)) !==
        digest(expected)
      )
        fail(409, "Collection digest mismatch.");
    for (const expected of m.lessons)
      if (
        digest(await this.repo.getNativeLesson(owner, expected.id)) !==
        digest(expected)
      )
        fail(409, "Lesson digest mismatch.");
    for (const expected of m.publications) {
      const row = await this.repo.getLessonPublication(
        owner,
        expected.lessonId,
        expected.contentVersion,
      );
      if (
        !row ||
        digest({
          content: row.content,
          references: row.references,
          source_url: row.sourceUrl,
        }) !==
          digest({
            content: expected.content,
            references: expected.references,
            source_url: expected.sourceUrl,
          })
      )
        fail(409, "Publication digest mismatch.");
    }
    for (const expected of resolved.states) {
      const row = await this.repo.getNativePrivateState(
        owner,
        expected.lessonId,
        expected.contentVersion,
      );
      if (!row || digest(privateData(row)) !== digest(privateData(expected)))
        fail(409, "Private history digest mismatch.");
    }
    const observedHistory = new Map<string, LearningHistoryEntry[]>();
    for (const expected of resolved.history) {
      const group = JSON.stringify([
        expected.lessonId,
        expected.contentVersion,
      ]);
      let rows = observedHistory.get(group);
      if (!rows) {
        rows = await this.repo.listLearningHistory(
          owner,
          expected.lessonId,
          expected.contentVersion,
          "",
          resolved.history.length + 1,
        );
        observedHistory.set(group, rows);
      }
      const row = rows.find((r) => r.id === expected.id);
      if (
        !row ||
        row.revision !== expected.revision ||
        row.component !== expected.component ||
        digest(privateData(row.state)) !== digest(privateData(expected.state))
      )
        fail(409, "An original private history revision differs.");
    }
    for (const expected of resolved.receipts) {
      const row = await this.repo.getOperation(
        owner,
        "learning-compat:" + expected.id,
      );
      if (
        !row ||
        row.payloadHash !== expected.hash ||
        row.entityId !== expected.lesson_id ||
        row.status !==
          (expected.status === "applied"
            ? "accepted"
            : expected.status === "conflict"
              ? "conflict"
              : "rejected")
      )
        fail(409, "A durable source receipt differs.");
    }
  }
}
