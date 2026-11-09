import type { NativeLearningService } from "./native-learning.service.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { NativePrivateState } from "./native-learning.types.ts";
import { randomUUID } from "node:crypto";
import {
  integer,
  keys,
  text,
  version,
  answers,
  fail,
  privateData,
} from "./native-learning.validation.ts";
export class NativePrivateLearning {
  constructor(private readonly learning: NativeLearningService) {}
  private empty(
    owner: LightTickOwner,
    id: string,
    v: string,
  ): NativePrivateState {
    return {
      ...owner,
      lessonId: id,
      contentVersion: v,
      revision: 1,
      draftVersion: v,
      notesRevision: 0,
      positionRevision: 0,
      completionRevision: 0,
      notes: "",
      answers: [],
      position: 0,
      completed: false,
      completedAt: null,
      updatedAt: this.learning.clock().toISOString(),
    };
  }
  async privateState(owner: LightTickOwner, id: string, v: string) {
    version(v);
    return this.learning.repository.transaction(owner, async () => {
      const a = await this.learning.requireActive(owner);
      if (!a.privateEnabled) fail(403, "Private learning consent is required.");
      await this.learning.publication(owner, id, v);
      const state =
        (await this.learning.repository.getNativePrivateState(owner, id, v)) ??
        this.empty(owner, id, v);
      return state;
    });
  }
  async privateCommand(
    owner: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
    authorize?: () => Promise<void>,
    compat = false,
  ) {
    const v = version(b.content_version),
      action = text(b.action, 20, true);
    if (!["save", "complete", "position"].includes(action))
      fail(422, "Unknown private learning action.");
    const fields = compat
      ? [
          "id",
          "content_version",
          "revision",
          "action",
          "notes",
          "answers",
          "position",
        ]
      : [
          "content_version",
          "base_revision",
          "action",
          ...(action === "save"
            ? ["notes", "answers", "draft_version"]
            : action === "position"
              ? ["position"]
              : []),
        ];
    keys(b, fields);
    const body = compat
      ? {
          id: key,
          content_version: v,
          revision: integer(b.revision, 1, 2147483647),
          action,
          notes: text(b.notes, 10000),
          answers: answers(b.answers),
          position: integer(b.position, 0, 100000),
        }
      : b;
    return this.learning.command(
      owner,
      key,
      "private:" + action,
      id,
      body,
      async () => {
        const published = await this.learning.publication(owner, id);
        if (compat && published.publication.contentVersion !== v)
          fail(
            409,
            "Published content changed; compare the old-version input before retrying.",
          );
        const current = await this.privateState(owner, id, v),
          component =
            action === "save"
              ? "notes"
              : action === "position"
                ? "position"
                : "completion",
          base = integer(compat ? b.revision : b.base_revision, 0, 2147483647),
          actual = compat
            ? current.revision
            : component === "notes"
              ? current.notesRevision
              : component === "position"
                ? current.positionRevision
                : current.completionRevision;
        if (base !== actual)
          fail(409, "Private state changed; keep the local and cloud copies.");
        if (
          !(await this.learning.repository.getNativePrivateState(owner, id, v))
        ) {
          await this.learning.repository.saveNativePrivateState(current, 0);
          await this.learning.repository.appendLearningHistory({
            ...owner,
            id: randomUUID(),
            lessonId: id,
            contentVersion: v,
            component: "initial",
            revision: 1,
            state: current,
            createdAt: current.updatedAt,
          });
        }
        const now = this.learning.clock().toISOString();
        const next = {
          ...current,
          revision: current.revision + 1,
          updatedAt: now,
        };
        if (action === "save") {
          next.notes = text(b.notes, 10000);
          if (!compat && b.draft_version !== undefined) {
            const anchor = version(b.draft_version);
            if (anchor !== v && anchor !== (current.draftVersion ?? v))
              fail(409, "Review the current draft anchor before changing it.");
            next.draftVersion = anchor;
          }
          next.answers = answers(b.answers);
          next.notesRevision++;
        } else if (action === "position") {
          next.position = integer(b.position, 0, 100000);
          next.positionRevision++;
        } else {
          next.completed = true;
          next.completedAt = current.completedAt ?? now;
          next.completionRevision++;
        }
        await this.learning.repository.saveNativePrivateState(
          next,
          current.revision,
        );
        await this.learning.repository.appendLearningHistory({
          ...owner,
          id: randomUUID(),
          lessonId: id,
          contentVersion: v,
          component,
          revision: next.revision,
          state: next,
          createdAt: now,
        });
        return privateData(next);
      },
      authorize,
      compat,
    );
  }
}
