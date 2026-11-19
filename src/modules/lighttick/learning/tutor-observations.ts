import type { LightTickOwner } from "../lighttick.types.ts";
import type { ManualDraft } from "../manual/manual-planning.types.ts";
import type { LearningWorkService } from "./learning-work.service.ts";
import type { LearningWork, TutorObservation } from "./learning-work.types.ts";
import { fail, identity, integer, keys, text, version } from "./native-learning.validation.ts";
import { tutorMaterial } from "./tutor-material.ts";

const observationLifetimeMs = 30 * 86400000;

export class TutorObservations {
  constructor(private readonly work: LearningWorkService) {}

  private get native() { return this.work.native; }

  private async scope(owner: LightTickOwner, routeId: string) {
    const plans = await this.native.repository.listPlans(owner);
    const goalIds = new Set(plans.filter(plan => plan.source === "learning_schedule" && plan.status === "active" &&
      (plan.proposal.learning_route_id === routeId ||
        (plan.proposal.draft as unknown as ManualDraft).tasks.some(item => item.lesson_source?.route_id === routeId)))
      .map(plan => plan.goalId));
    for (const id of goalIds) {
      const goal = await this.native.repository.getGoal(owner, id);
      if (!goal || goal.status === "archived" || goal.status === "completed") goalIds.delete(id);
    }
    if (goalIds.size > 1) fail(409, "The learning goal scope changed.");
    return [...goalIds][0] ?? null;
  }

  private async evidence(owner: LightTickOwner, lessonId: string, contentVersion: string) {
    const authority = await this.native.requireActive(owner);
    if (!authority.privateEnabled) fail(403, "Private learning consent is required.");
    const { lesson, publication } = await this.native.publication(owner, lessonId, contentVersion);
    if (!publication.tutorTopic) fail(404, "This lesson version has no tutor material.");
    const route = await this.work.routes.require(owner, lesson.collectionId);
    const state = await this.native.privateState(owner, lessonId, contentVersion);
    const consent = authority.consentRevision ?? 0;
    const rows = (await this.work.store.tutorTurns(owner, lessonId, contentVersion)).filter(row => row.input.consent_revision === consent);
    const disputed = new Set(rows.filter(row => row.input.dispute).map(row => row.input.parent_id));
    const material = tutorMaterial(publication.tutorTopic);
    const eligible = lesson.publishedVersion === contentVersion && route.status !== "archived"
      ? rows.filter(row => row.input.action === "feedback" && row.status === "succeeded" && row.output &&
        row.input.answer_revision === state.notesRevision && !disputed.has(row.id))
      : [];
    return { lesson, route, state, material, consent, eligible };
  }

  private async project(owner: LightTickOwner, lessonId: string, contentVersion: string, row?: TutorObservation) {
    const current = await this.evidence(owner, lessonId, contentVersion);
    const scoped = row && !row.stopped && row.contentVersion === contentVersion && row.consentRevision === current.consent &&
      row.sourceDigest === current.material.source_digest && row.expiresAt > this.native.clock().toISOString() &&
      row.goalId === await this.scope(owner, current.route.id);
    const source = scoped ? current.eligible.find(turn => turn.id === row.turnId && turn.input.answer_revision === row.answerRevision) : undefined;
    return { current, source, active: source ? row : undefined };
  }

  read(owner: LightTickOwner, lessonId: string, contentVersion: string) {
    return this.native.repository.transaction(owner, async () => {
      const row = await this.work.store.tutorObservation(owner, lessonId);
      const { current, source, active } = await this.project(owner, lessonId, version(contentVersion), row);
      return {
        revision: row?.revision ?? 0,
        completed: current.state.completed,
        status: active ? "active" : row && !row.stopped ? "unavailable" : "off",
        available_turns: current.eligible.map(turn => turn.id),
        observation: source && active ? {
          turn_id: source.id, content_version: active.contentVersion, answer_revision: active.answerRevision,
          concept_id: current.material.concept.id, source_digest: active.sourceDigest, goal_id: active.goalId,
          expires_at: active.expiresAt, verdict: source.output!.verdict,
          assistance: source.input.assistance ?? [], correction: active.correction,
        } : null,
      };
    });
  }

  command(owner: LightTickOwner, lessonId: string, body: Record<string, unknown>, key: string, authorize: () => Promise<void>) {
    const action = text(body.action, 12, true);
    if (!["allow", "correct", "stop"].includes(action)) fail(422, "Unknown observation action.");
    keys(body, ["content_version", "action", "base_revision", ...(action === "allow" ? ["turn_id"] : action === "correct" ? ["correction"] : [])]);
    const contentVersion = version(body.content_version);
    const base = integer(body.base_revision, 0, 2147483646);
    return this.native.command(owner, key, "private:tutor-observation", lessonId, body, async () => {
      const row = await this.work.store.tutorObservation(owner, lessonId);
      if ((row?.revision ?? 0) !== base) fail(409, "Review the current observation before changing it.");
      const { current, active } = await this.project(owner, lessonId, contentVersion, row);
      let next: TutorObservation;
      if (action === "allow") {
        const id = identity(body.turn_id, "work-");
        const source = current.eligible.find(turn => turn.id === id);
        if (!source) fail(409, "Choose feedback on the current answer.");
        next = {
          ...owner, lessonId, routeId: current.route.id, goalId: await this.scope(owner, current.route.id),
          contentVersion, sourceDigest: current.material.source_digest, turnId: source.id,
          consentRevision: current.consent, answerRevision: source.input.answer_revision, revision: base + 1,
          expiresAt: new Date(this.native.clock().getTime() + observationLifetimeMs).toISOString(),
          stopped: false, correction: null,
        };
      } else {
        if (!row || row.stopped || (action === "correct" && !active)) {
          fail(409, "Review the current observation before changing it.");
        }
        next = { ...row, revision: base + 1, stopped: action === "stop",
          correction: action === "correct" ? text(body.correction, 280, true) : null };
      }
      await this.work.store.saveTutorObservation(next, base);
      return { revision: next.revision };
    }, authorize);
  }

  async snapshot(owner: LightTickOwner, lessonId: string, contentVersion: string) {
    const row = await this.work.store.tutorObservation(owner, lessonId);
    if (!row || row.stopped) return;
    const { current, source, active } = await this.project(owner, lessonId, contentVersion, row);
    if (source && active) return {
      revision: active.revision,
      summary: { concept: current.material.concept.title, assisted: !!source.input.assistance?.length,
        ...(active.correction ? { learner_correction: active.correction } : { practice_feedback: source.output!.verdict }) },
    };
  }

  async assertCurrent(work: LearningWork) {
    const snapshot = await this.snapshot(work, work.input.lesson_id, work.input.content_version);
    if (snapshot?.revision !== work.input.observation_revision) throw Error("LEARNING_CONTEXT_STALE");
  }
}
