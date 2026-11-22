import { captureModel } from "../personal-model/personal-model.service.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { LEARNING_WORK_LIMITS, type LearningWorkService } from "./learning-work.service.ts";
import type { LearningWork } from "./learning-work.types.ts";
import { digest, fail, identity, integer, keys, text, version } from "./native-learning.validation.ts";
import { TutorObservations } from "./tutor-observations.ts";
import { tutorMaterial, tutorPublication } from "./tutor-material.ts";

const actions = ["explain", "example", "hint", "ask", "feedback", "reference"] as const;
type TutorAction = typeof actions[number];
const helpActions: readonly TutorAction[] = ["explain", "example", "hint", "ask"];
const reserveMicros = 30000;

export class TutorWork {
  constructor(readonly work: LearningWorkService) {}

  private async access(owner: LightTickOwner, lessonId: string, contentVersion: string) {
    const authority = await this.work.native.requireActive(owner);
    if (!authority.privateEnabled) fail(403, "Private learning consent is required.");
    const { lesson, publication } = await this.work.native.publication(owner, lessonId, contentVersion);
    if (!publication.tutorTopic) fail(404, "This lesson version has no tutor material.");
    return { authority, lesson, publication, material: tutorMaterial(publication.tutorTopic) };
  }

  async read(owner: LightTickOwner, lessonId: string, contentVersion: string) {
    return this.work.native.repository.transaction(owner, async () => {
      const { authority, lesson } = await this.access(owner, lessonId, version(contentVersion));
      const state = await this.work.native.privateState(owner, lessonId, contentVersion);
      const turns = (await this.work.store.tutorTurns(owner, lessonId, contentVersion)).filter(row => row.input.consent_revision === (authority.consentRevision ?? 0));
      const disputed = new Set(turns.filter(row => typeof row.input.dispute === "string" && row.input.dispute).map(row => row.input.parent_id));
      return {
        turns: turns.map(row => ({
          work: this.work.data(row),
          action: row.input.action,
          submission: row.input.submission ?? null,
          message: row.input.message ?? "",
          parent_id: row.input.parent_id ?? null,
          answer_revision: row.input.answer_revision ?? null,
          assistance: row.input.assistance ?? [],
          disputed: disputed.has(row.id),
          current: lesson.publishedVersion === contentVersion &&
            (row.input.answer_revision === undefined || row.input.answer_revision === state.notesRevision),
        })),
      };
    });
  }

  async submit(owner: LightTickOwner, lessonId: string, body: Record<string, unknown>, key: string, authorize: () => Promise<void>) {
    keys(body, ["content_version", "action", "concept_id", "question_id", "consent", "answer_revision", "parent_id", "message"]);
    const contentVersion = version(body.content_version), action = text(body.action, 20, true) as TutorAction;
    if (!actions.includes(action)) fail(422, "Unknown tutor action.");
    if (action !== "reference" && body.consent !== true) fail(422, "Allow this request before sending it to the model.");
    const message = text(body.message ?? "", 600, action === "ask");
    const parentId = body.parent_id === undefined ? null : identity(body.parent_id, "work-");
    const receipt = await this.work.native.command(owner, key, "private:tutor-turn", lessonId, body, async () => {
      const { authority, lesson, publication, material } = await this.access(owner, lessonId, contentVersion);
      if (action !== "reference" && !this.work.scheduleSuggestionsEnabled()) fail(503, "Teaching generation is unavailable.");
      if (lesson.publishedVersion !== contentVersion) fail(409, "Use the current version for new tutor requests.");
      if (body.concept_id !== material.concept.id || body.question_id !== material.question.id) fail(422, "Course concept or question changed.");
      const allRows = await this.work.store.tutorTurns(owner, lessonId, contentVersion);
      const consentRevision = authority.consentRevision ?? 0;
      const rows = allRows.filter(row => row.input.consent_revision === consentRevision);
      const parent = parentId ? rows.find(row => row.id === parentId) : undefined;
      if (parentId && (!parent || action === "reference" ||
        (action === "feedback" ? parent.input.action !== "feedback" : !helpActions.includes(parent.input.action) || parent.status !== "succeeded"))) {
        fail(409, "This conversation or feedback revision is unavailable.");
      }
      const id = "work-" + digest([owner.userId, lessonId, key]).slice(0, 40);
      const input: LearningWork["input"] = {
        action, lesson_id: lessonId, content_version: contentVersion,
        consent_revision: consentRevision, parent_id: parentId, message,
      };
      const assistance = rows.filter(row => row.status === "succeeded").map(row => row.input.action);
      if (action === "feedback") {
        const state = await this.work.native.privateState(owner, lessonId, contentVersion);
        const revision = integer(body.answer_revision, 1, 2147483647);
        if (revision !== state.notesRevision) fail(409, "Your saved answer has changed.");
        const answer = state.answers.find(entry => entry.id === material.question.id);
        input.submission = text(answer?.answer, 2400, true);
        if (Buffer.byteLength(input.submission) > 6400) fail(422, "Answer exceeds the tutor input limit.");
        input.answer_revision = revision;
        input.assistance = ["hint", "reference"].filter(item => assistance.includes(item));
        input.dispute = parent?.status === "succeeded" ? text(message, 600, true) : "";
        const original = rows.find(row => row.input.action === action && row.input.answer_revision === revision &&
          row.input.parent_id === parentId && row.input.dispute === input.dispute);
        if (original) return this.work.data(original);
      } else if (action === "reference") {
        const original = rows.find(row => row.input.action === action);
        if (original) return this.work.data(original);
      }
      if (allRows.length >= 50) fail(429, "This lesson has reached the tutor turn limit.");
      const now = this.work.native.clock().toISOString();
      const reservedMicros = action === "reference" ? 0 : reserveMicros;
      if (reservedMicros) {
        const recent = await this.work.store.recent(owner, now.slice(0, 10) + "T00:00:00.000Z");
        if (recent.length >= LEARNING_WORK_LIMITS.dailyJobs ||
          recent.reduce((sum, row) => sum + row.reservedMicros, 0) + reservedMicros > LEARNING_WORK_LIMITS.dailyEstimatedMicros) {
          fail(429, "Daily learning work budget is exhausted.");
        }
        input.model_selection = await captureModel(this.work.native.repository, owner);
        input.material = {
          source: material.source.text,
          excerpt: tutorPublication(material.topic, publication.content).body.slice(0, 900),
          concept: material.concept, question: material.question,
        };
        if (helpActions.includes(action)) {
          const observation = await new TutorObservations(this.work).snapshot(owner, lessonId, contentVersion);
          if (observation) {
            input.observation_revision = observation.revision;
            input.observation = observation.summary;
          }
          // Do not forward a reply derived from observation permission that has changed.
          if (parent?.output && (parent.input.observation_revision === undefined ||
              parent.input.observation_revision === observation?.revision)) {
            input.previous = { request: parent.input.message, reply: parent.output.message };
          }
        }
      }
      const route = await this.work.routes.require(owner, lesson.collectionId);
      const row: LearningWork = {
        ...owner, id, routeId: route.id, revision: 1, kind: "tutor_turn",
        status: action === "reference" ? "succeeded" : "queued",
        epoch: authority.epoch, baseRouteRevision: route.revision,
        input, output: null, attempt: 0, fence: null, leaseUntil: null,
        reservedMicros, errorCode: null, createdAt: now, updatedAt: now,
      };
      await this.work.store.save(row, 0);
      return this.work.data(row);
    }, authorize);
    await this.work.read(owner, receipt.id);
    await this.work.dispatch(owner, receipt.id);
    return receipt;
  }
}

export const TUTOR_SCHEMA = {
  type: "object", additionalProperties: false, required: ["message", "next_step", "verdict", "answer_quote"],
  properties: {
    message: { type: "string", maxLength: 1200 },
    next_step: { type: "string", maxLength: 450 },
    verdict: { enum: ["help", "supported", "needs_revision", "uncertain"] },
    answer_quote: { type: "string", maxLength: 340 },
  },
} as const;

export function tutorOutput(raw: Record<string, unknown>, input: LearningWork["input"]) {
  keys(raw, [...TUTOR_SCHEMA.required]);
  const message = text(raw.message, 1200, true), nextStep = text(raw.next_step, 450, true);
  const verdict = text(raw.verdict, 20, true), quote = text(raw.answer_quote, 340, false);
  const feedback = input.action === "feedback";
  if (feedback ? !["supported", "needs_revision", "uncertain"].includes(verdict) : verdict !== "help") fail(422, "Invalid tutor verdict.");
  if ((quote && (!feedback || !String(input.submission).includes(quote))) || (verdict === "supported" && !quote)) {
    fail(422, "Feedback must use an exact quote from this submitted answer.");
  }
  if (/https?:\/\//i.test(message + nextStep)) fail(422, "Tutor comments cannot introduce outside references.");
  return { message, next_step: nextStep, verdict, answer_quote: quote, concept_id: input.material.concept.id, question_id: input.material.question.id };
}
