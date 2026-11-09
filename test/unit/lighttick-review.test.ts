import { exportReview } from "../../src/modules/lighttick/knowledge/review.export.ts";
import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { KnowledgeService } from "../../src/modules/lighttick/knowledge/knowledge.service.ts";
import { ReviewService } from "../../src/modules/lighttick/knowledge/review.service.ts";
import { LightTickRecordService } from "../../src/modules/lighttick/lighttick-record.service.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
const o = { appId: "lighttick" as const, userId: "synthetic-review" };
const recordBody = {
  base_version: 0,
  raw_text: "Observed synthetic reasoning",
  record_date: "2026-11-04",
  prompt_kind: "learning",
  tags: [],
  guided_answers: {},
};
const node = {
  base_revision: 0,
  kind: "cognition",
  title: "A reviewed interpretation",
  body: "This is my interpretation, not proof",
  tags: [],
  sources: [{ kind: "record", id: "record-review-fixture", version: "1" }],
};
test("review snapshot uses confirmed authorized facts, bound replay cursors and separate completion signals", async () => {
  const repo = new InMemoryLightTickRepository(),
    records = new LightTickRecordService(repo),
    knowledge = new KnowledgeService(repo),
    review = new ReviewService(repo),
    native = new NativeLearningService(repo, true);
  await records.mutate(
    o,
    "record-review-fixture",
    "save",
    recordBody,
    "review-record-original",
  );
  await knowledge.mutate(
    o,
    "knowledge-review-fixture",
    "save",
    node,
    "review-knowledge-original",
  );
  await native.saveCollection(
    o,
    "review-course",
    { base_revision: 0, title: "Published course", archived: false },
    "review-collection",
  );
  const l = await native.publish(
    o,
    "lesson-review-fixture",
    {
      base_revision: 0,
      collection_id: "review-course",
      number: 1,
      title: "Published reasoning",
      content: "Saved lesson synthetic content",
      references: "",
      source_url: "",
    },
    "review-lesson",
  );
  await native.privateCommand(
    o,
    l.id,
    {
      action: "position",
      content_version: l.content_version,
      base_revision: 0,
      position: 40,
    },
    "review-position",
  );
  let snapshot = await review.snapshot(o, { limit: "1" });
  assert.equal(snapshot.counts.lesson_completed, 0);
  assert.equal(snapshot.total, 3);
  assert.ok(snapshot.next_cursor);
  assert.deepEqual(
    await review.snapshot(o, { limit: "1", cursor: snapshot.next_cursor! }),
    await review.snapshot(o, { limit: "1", cursor: snapshot.next_cursor! }),
  );
  await assert.rejects(
    review.snapshot(
      { ...o, userId: "other-owner" },
      { cursor: snapshot.next_cursor! },
    ),
    { code: "LIGHTTICK_REVIEW_CURSOR_EXPIRED" },
  );
  await native.privateCommand(
    o,
    l.id,
    {
      action: "save",
      content_version: l.content_version,
      base_revision: 0,
      notes: "Private confirmed note",
      answers: [],
    },
    "review-notes",
  );
  await assert.rejects(review.snapshot(o, { cursor: snapshot.next_cursor! }), {
    code: "LIGHTTICK_REVIEW_CURSOR_EXPIRED",
  });
  await native.privateCommand(
    o,
    l.id,
    {
      action: "complete",
      content_version: l.content_version,
      base_revision: 0,
    },
    "review-complete",
  );
  snapshot = await review.snapshot(o);
  assert.equal(snapshot.counts.lesson_completed, 1);
  assert.equal(snapshot.counts.learning_notes, 1);
  assert.equal(snapshot.counts.cognition, 1);
  const beforePosition=snapshot.revision;await native.privateCommand(o,l.id,{action:'position',content_version:l.content_version,base_revision:1,position:50},'review-position-again');
  assert.equal((await review.snapshot(o)).revision,beforePosition,'moving reading position does not date or revise the saved notes projection');

  await native.publish(
    o,
    l.id,
    {
      base_revision: 1,
      collection_id: "review-course",
      number: 1,
      title: "Published reasoning",
      content: "New version",
      references: "",
      source_url: "",
    },
    "review-republish",
  );
  snapshot = await review.snapshot(o);
  assert.equal(snapshot.counts.lesson_completed, 0);
  assert.equal(snapshot.counts.learning_notes, 0);
  assert.equal(
    (await native.privateState(o, l.id, l.content_version)).notes,
    "Private confirmed note",
  );
  const exported = await exportReview(repo, o, async () => {});
  const payload = JSON.parse(exported.content);
  assert.equal(
    exported.sha256,
    createHash("sha256").update(exported.content).digest("hex"),
  );
  assert.equal(payload.learning.publications.length, 2);
  assert.equal(payload.learning.states[0].notes, "Private confirmed note");
  assert.equal("operations" in payload, false);
  const authority = (await native.authority(o))!;
  await native.consent(
    o,
    {
      base_revision: authority.revision,
      reading_enabled: true,
      private_enabled: false,
    },
    "review-export-private-off",
  );
  const publicOnly = JSON.parse(
    (await exportReview(repo, o, async () => {})).content,
  );
  assert.equal(publicOnly.learning.states.length, 0);
  assert.equal(publicOnly.learning.history.length, 0);
  assert.equal(
    publicOnly.facts.some((f: any) => f.kind === "learning_notes"),
    false,
  );
  await repo.saveActionWorkspace({
    ...o,
    version: 1,
    data: {
      plans: [
        {
          id: "action-fixture",
          revision: 3,
          title: "Practice",
          status: "active",
          practice_feedback: [
            {
              id: "feedback-fixture",
              created_at: "2026-11-04T00:00:00Z",
              outcome: "applied",
              result: "Self reported",
              evidence: "Owner submitted",
              next_step: "Review again",
            },
          ],
        },
      ],
      records: [
        {
          id: "session-fixture",
          plan_id: "action-fixture",
          title: "Practice",
          record_kind: "session",
          outcome: "partial",
          ended_at: "2026-11-04T00:00:00Z",
          business_date: "2026-11-04",
          note: "Confirmed session",
        },
      ],
      reviews: [],
      reports: [],
      claims: {},
    } as any,
  });
  snapshot = await review.snapshot(o);
  assert.equal(snapshot.counts.practice_feedback, 1);
  assert.equal(snapshot.counts.action_execution, 1);
  assert.equal(snapshot.counts.action_completed, 0);
});
test("source archive or learning withdrawal removes search/graph text and refuses old receipt leakage", async () => {
  const repo = new InMemoryLightTickRepository(),
    r = new LightTickRecordService(repo),
    k = new KnowledgeService(repo),
    s = new ReviewService(repo);
  await r.mutate(
    o,
    "record-review-fixture",
    "save",
    recordBody,
    "review-source-create",
  );
  await k.mutate(
    o,
    "knowledge-review-fixture",
    "save",
    node,
    "review-linked-original",
  );
  await r.mutate(
    o,
    "record-review-fixture",
    "archive",
    { base_version: 1 },
    "review-source-archive",
  );
  assert.equal((await s.snapshot(o)).total, 0);
  await assert.rejects(k.read(o, "knowledge-review-fixture"), {
    statusCode: 403,
  });
  await assert.rejects(
    k.mutate(
      o,
      "knowledge-review-fixture",
      "save",
      node,
      "review-linked-original",
    ),
    { statusCode: 403 },
  );
  await assert.rejects(s.snapshot(o, { start: "2026-02-30" }), {
    statusCode: 422,
  });
  await assert.rejects(s.snapshot(o, { timezone: "Invalid/Zone" }), {
    statusCode: 422,
  });
  assert.equal((await s.snapshot({ ...o, userId: "other" })).total, 0);
});
