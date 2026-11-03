import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
export function learningMigrationFixture(target = "migration-alice") {
  const content = "## 思考题\n- 如何应用？",
    oldContent = "Original earlier lesson",
    current = digest({ content, references: "" }),
    old = digest({ content: oldContent, references: "" }),
    draft = digest("old raw note anchor");
  const now = "2026-11-03T00:00:00.000Z",
    lesson = "lesson-legacy-fixture";
  const applied = {
    id: "legacy-known-0001",
    lesson_id: lesson,
    content_version: old,
    revision: 1,
    action: "complete",
    notes: "",
    answers: [],
    position: 0,
  };
  const pending = {
    id: "legacy-pending-0001",
    lesson_id: lesson,
    content_version: current,
    revision: 4,
    action: "save",
    notes: "Queued phone note",
    answers: [
      { id: "old-question:1", prompt: "Old prompt", answer: "Retained answer" },
    ],
    position: 35,
  };
  const conflicted = {
    ...pending,
    id: "legacy-pending-0002",
    action: "complete",
  };
  const state = (v: string, revision: number) => ({
    lesson_id: lesson,
    content_version: v,
    draft_version: v === current ? draft : v,
    revision,
    notes: v === current ? "Current source note" : "Older source note",
    answers: [],
    position: 35,
    completed: v === old,
    completed_at: null,
    updated_at: now,
  });
  const bundle = {
    format_version: 1,
    module: "learning",
    mapping: {
      target_user_id: target,
      source_account_id: "legacy-source-alice",
      source_instance: "synthetic-source",
      verified: true,
    },
    source: {
      instance: "synthetic-source",
      account_id: "legacy-source-alice",
      binding_id: "synthetic-binding",
      library_revision: 9,
      private_revision: 7,
      frozen: true,
      frozen_at: now,
    },
    consent: { reading: true, private: true },
    collections: [
      { id: "英语/基础", title: "Original course", archived: false },
    ],
    lessons: [
      {
        id: lesson,
        collection_id: "英语/基础",
        number: 1,
        title: "Preserved lesson",
        content_version: current,
        learning_state: "unknown",
        publications: [
          {
            content_version: old,
            content: oldContent,
            references: "",
            source_url: "",
          },
          { content_version: current, content, references: "", source_url: "" },
        ],
      },
    ],
    private_states: [state(old, 2), state(current, 4)],
    private_history: [state(old, 1)],
    receipts: [
      {
        id: applied.id,
        lesson_id: lesson,
        hash: digest(applied),
        status: "applied",
        error: "",
        created_at: null,
      },
      {
        id: pending.id,
        lesson_id: lesson,
        hash: digest(pending),
        status: "pending",
        error: "",
        body: pending,
        created_at: null,
      },
      {
        id: conflicted.id,
        lesson_id: lesson,
        hash: digest(conflicted),
        status: "pending",
        error: "",
        body: conflicted,
        created_at: null,
      },
    ],
  };
  return {
    bundle,
    digest: digest(bundle),
    lesson,
    current,
    old,
    draft,
    applied,
    pending,
    conflicted,
  };
}
