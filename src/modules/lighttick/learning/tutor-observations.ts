import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { ManualDraft } from "../manual/manual-planning.types.ts";
import type { LearningWorkService } from "./learning-work.service.ts";
import type { LearningWork, TutorObservation } from "./learning-work.types.ts";
import { digest, fail, identity, integer, keys, text, version } from "./native-learning.validation.ts";
import { tutorMaterial } from "./tutor-material.ts";

const observationLifetimeMs = 30 * 86_400_000;
const observationRuleVersion = 1;
const feedbackVerdicts = ["supported", "needs_revision", "uncertain"] as const;
type Verdict = (typeof feedbackVerdicts)[number];
type Assistance = "hint" | "reference";
type InvalidReason = "authorization_changed" | "publication_changed" | "scope_changed" | "expired" | "source_changed";
type Feedback = { turn: LearningWork; verdict: Verdict; assistance: Assistance[]; answerRevision: number };
type Projection = { active: { row: TutorObservation; source: Feedback } } | { invalidReason?: InvalidReason };

interface GoalScope {
  goalId: string | null;
  fingerprint: string;
  available: boolean;
}

export class TutorObservations {
  constructor(private readonly work: LearningWorkService) {}

  private get native() { return this.work.native; }

  private async scope(owner: LightTickOwner, routeId: string): Promise<GoalScope> {
    const plans = (await this.native.repository.listPlans(owner)).filter(plan => {
      if (plan.source !== "learning_schedule") return false;
      const draft = plan.proposal.draft as Partial<ManualDraft> | undefined;
      return plan.proposal.learning_route_id === routeId ||
        (Array.isArray(draft?.tasks) && draft.tasks.some(item => item?.lesson_source?.route_id === routeId));
    });
    const goalIds = [...new Set(plans.filter(plan => plan.status === "active").map(plan => plan.goalId))].sort();
    if (!goalIds.length) return { goalId: null, fingerprint: digest([routeId, null]), available: true };
    if (goalIds.length !== 1) return { goalId: null, fingerprint: digest([routeId, goalIds]), available: false };
    const goal = await this.native.repository.getGoal(owner, goalIds[0]!);
    // Another reviewed schedule or a harmless edit to the same goal doesn't change the scope of the grant.
    return { goalId: goalIds[0]!, available: goal?.status === "active",
      fingerprint: digest([routeId, goal?.id ?? null, goal?.status ?? null]) };
  }

  private async evidence(owner: LightTickOwner, lessonId: string, contentVersion: string) {
    const authority = await this.native.requireActive(owner);
    if (!authority.readingEnabled || !authority.privateEnabled) fail(403, "Private learning consent is required.");
    const { lesson, publication } = await this.native.publication(owner, lessonId, contentVersion);
    if (!publication.tutorTopic) fail(404, "This lesson version has no tutor material.");
    const route = await this.work.routes.require(owner, lesson.collectionId);
    const state = await this.native.privateState(owner, lessonId, contentVersion);
    const material = tutorMaterial(publication.tutorTopic);
    const publicationDigest = digest([publication.content, publication.references, publication.sourceUrl, publication.tutorTopic]);
    const consentRevision = authority.consentRevision ?? 0;
    const scope = await this.scope(owner, route.id);
    const eligible: Feedback[] = [];
    if (lesson.publishedVersion === contentVersion && route.status === "active" && route.publishedVersion > 0 && scope.available) {
      const rows = (await this.work.store.tutorTurns(owner, lessonId, contentVersion))
        .filter(row => row.epoch === authority.epoch && row.routeId === route.id && row.input.consent_revision === consentRevision);
      const disputed = new Set(rows.filter(row => typeof row.input.dispute === "string" && row.input.dispute)
        .map(row => row.input.parent_id));
      const answer = state.answers.find(entry => entry.id === material.question.id);
      for (const turn of rows) {
        const verdict: unknown = turn.output?.verdict;
        if (turn.input.action !== "feedback" || turn.status !== "succeeded" ||
            !feedbackVerdicts.includes(verdict as Verdict) || disputed.has(turn.id) || !answer?.answer ||
            turn.input.answer_revision !== state.notesRevision || turn.input.submission !== answer.answer ||
            turn.input.material?.concept?.id !== material.concept.id || turn.input.material?.question?.id !== material.question.id) continue;
        const assistance = (["hint", "reference"] as const).filter(action =>
          Array.isArray(turn.input.assistance) && turn.input.assistance.includes(action));
        eligible.push({ turn, verdict: verdict as Verdict, assistance, answerRevision: state.notesRevision });
      }
    }
    return { authority, lesson, route, state, material, publicationDigest, consentRevision, scope, eligible };
  }

  private project(contentVersion: string, evidence: Awaited<ReturnType<TutorObservations["evidence"]>>,
    row: TutorObservation | undefined): Projection {
    if (!row || row.stopped) return {};
    if (row.epoch !== evidence.authority.epoch || row.consentRevision !== evidence.consentRevision)
      return { invalidReason: "authorization_changed" };
    if (row.contentVersion !== contentVersion || evidence.lesson.publishedVersion !== contentVersion ||
      row.routeVersion !== evidence.route.publishedVersion || row.sourceDigest !== evidence.material.source_digest ||
      row.publicationDigest !== evidence.publicationDigest || row.ruleVersion !== observationRuleVersion)
      return { invalidReason: "publication_changed" };
    if (!evidence.scope.available || evidence.route.status !== "active" || row.routeId !== evidence.route.id ||
      row.goalId !== evidence.scope.goalId || row.goalScopeDigest !== evidence.scope.fingerprint)
      return { invalidReason: "scope_changed" };
    if (row.expiresAt <= this.native.clock().toISOString()) return { invalidReason: "expired" };
    const source = evidence.eligible.find(item => item.turn.id === row.turnId &&
      item.turn.revision === row.turnRevision && item.answerRevision === row.answerRevision);
    return source ? { active: { row, source } } : { invalidReason: "source_changed" };
  }

  read(owner: LightTickOwner, lessonId: string, contentVersion: string) {
    return this.native.repository.transaction(owner, async () => {
      const evidence = await this.evidence(owner, identity(lessonId, "lesson-"), version(contentVersion));
      const row = await this.work.store.tutorObservation(owner, lessonId);
      const projection = this.project(contentVersion, evidence, row);
      return {
        revision: row?.revision ?? 0,
        completed: evidence.state.completed,
        status: "active" in projection ? "active" as const : projection.invalidReason ? "unavailable" as const : "off" as const,
        available_turns: evidence.eligible.map(item => item.turn.id),
        ...("active" in projection || !projection.invalidReason ? {} : { invalid_reason: projection.invalidReason }),
        observation: "active" in projection ? {
          turn_id: projection.active.row.turnId,
          content_version: projection.active.row.contentVersion,
          answer_revision: projection.active.row.answerRevision,
          concept_id: evidence.material.concept.id,
          source_digest: projection.active.row.sourceDigest,
          goal_id: projection.active.row.goalId,
          route_id: projection.active.row.routeId,
          expires_at: projection.active.row.expiresAt,
          verdict: projection.active.source.verdict,
          assistance: projection.active.source.assistance,
          correction: projection.active.row.correction,
        } : null,
      };
    });
  }

  async command(owner: LightTickOwner, lessonId: string, body: Record<string, unknown>, key: string,
    authorize: () => Promise<void>) {
    identity(lessonId, "lesson-");
    const action = text(body.action, 12, true);
    if (action !== "allow" && action !== "correct" && action !== "stop") fail(422, "Unknown observation action.");
    keys(body, ["content_version", "action", "base_revision", ...(action === "allow" ? ["turn_id"] : action === "correct" ? ["correction"] : [])]);
    const contentVersion = version(body.content_version);
    const base = integer(body.base_revision, 0, 2147483646);
    const receipt = await this.native.command(owner, key, "private:tutor-observation", lessonId, body, async () => {
      const evidence = await this.evidence(owner, lessonId, contentVersion);
      const row = await this.work.store.tutorObservation(owner, lessonId);
      if ((row?.revision ?? 0) !== base) fail(409, "Review the current observation before changing it.");
      let next: TutorObservation;
      if (action === "allow") {
        const sourceId = identity(body.turn_id, "work-");
        const source = evidence.eligible.find(item => item.turn.id === sourceId);
        if (!source) fail(409, "Choose accessible feedback on the current answer in this course.");
        next = {
          ...owner, lessonId, routeId: evidence.route.id, routeVersion: evidence.route.publishedVersion,
          goalId: evidence.scope.goalId, goalScopeDigest: evidence.scope.fingerprint, contentVersion,
          sourceDigest: evidence.material.source_digest, publicationDigest: evidence.publicationDigest,
          epoch: evidence.authority.epoch, consentRevision: evidence.consentRevision,
          turnId: source.turn.id, turnRevision: source.turn.revision, answerRevision: source.answerRevision,
          ruleVersion: observationRuleVersion, revision: base + 1,
          expiresAt: new Date(this.native.clock().getTime() + observationLifetimeMs).toISOString(),
          stopped: false, correction: null,
        };
      } else {
        if (!row || row.stopped || (action === "correct" && !("active" in this.project(contentVersion, evidence, row)))) {
          fail(409, "Review the current observation before changing it.");
        }
        next = { ...row, revision: base + 1, stopped: action === "stop",
          correction: action === "correct" ? text(body.correction, 280, true) : null };
      }
      await this.work.store.saveTutorObservation(next, base);
      return { revision: next.revision, epoch: evidence.authority.epoch, consentRevision: evidence.consentRevision };
    }, authorize);
    const authority = await this.native.requireActive(owner);
    if (!authority.privateEnabled || !authority.readingEnabled || authority.epoch !== receipt.epoch ||
      (authority.consentRevision ?? 0) !== receipt.consentRevision)
      fail(403, "The observation belongs to an earlier learning permission.");
    return { revision: receipt.revision };
  }

  async snapshot(owner: LightTickOwner, lessonId: string, contentVersion: string) {
    return await this.native.repository.transaction(owner, async () => {
      const row = await this.work.store.tutorObservation(owner, lessonId);
      if (!row || row.stopped) return;
      try {
        const evidence = await this.evidence(owner, lessonId, contentVersion);
        const projection = this.project(contentVersion, evidence, row);
        if (!("active" in projection)) return;
        return { revision: row.revision, goalId: row.goalId, summary: {
          concept: evidence.material.concept.title,
          assisted: projection.active.source.assistance.length > 0,
          ...(row.correction ? { learner_correction: row.correction } : { practice_feedback: projection.active.source.verdict }),
        } };
      } catch (error) {
        if (error instanceof ApplicationError && [403, 404, 409].includes(error.statusCode)) return;
        throw error;
      }
    });
  }
}
