import type { LightTickRepository } from './lighttick.repository.ts';
import type { LightTickOwner } from './lighttick.types.ts';
import { ApplicationError } from '../../shared/errors.ts';

export interface LightTickReflectionRow extends LightTickOwner {
  id: string; goalId: string; planId?: string; periodStart: string; periodEnd: string;
  content: string; nextAction: string; version: number; createdAt: string; updatedAt: string;
}
export function assertReviewDates(start: string, end: string) {
  const valid = (v: string) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
  if (!valid(start) || !valid(end) || end < start)
    throw new ApplicationError(400, 'REQ_FIELD_INVALID', 'Review dates are invalid.');
}
export class LightTickReflectionService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}
  async list(owner: LightTickOwner, goalId: string) {
    await this.requireGoal(owner, goalId);
    return (await this.repository.listReflections(owner)).filter(r => r.goalId === goalId);
  }
  async save(owner: LightTickOwner, id: string, input: {
    goal_id: string; plan_id?: string; period_start: string; period_end: string;
    content: string; next_action?: string; base_version: number;
  }) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id) || !Number.isInteger(input.base_version) || input.base_version < 0 ||
      typeof input.content !== 'string' || !input.content.trim() || input.content.length > 4000 ||
      (input.next_action !== undefined && (typeof input.next_action !== 'string' || input.next_action.length > 1000)))
      throw new ApplicationError(400, 'REQ_FIELD_INVALID', 'Reflection content or version is invalid.');
    assertReviewDates(input.period_start, input.period_end);
    return this.repository.transaction(owner, async () => {
      await this.requireGoal(owner, input.goal_id);
      if (input.plan_id) {
        const plan = await this.repository.getPlan(owner, input.plan_id);
        if (!plan || plan.goalId !== input.goal_id)
          throw new ApplicationError(404, 'LIGHTTICK_RESOURCE_NOT_FOUND', 'Plan was not found for this goal.');
      }
      const existing = (await this.repository.listReflections(owner)).find(r => r.id === id);
      if (existing && existing.goalId !== input.goal_id)
        throw new ApplicationError(409, 'LIGHTTICK_VERSION_CONFLICT', 'Reflection belongs to a different goal.');
      const now = this.clock().toISOString();
      const row: LightTickReflectionRow = { ...owner, id, goalId: input.goal_id, planId: input.plan_id,
        periodStart: input.period_start, periodEnd: input.period_end, content: input.content,
        nextAction: input.next_action ?? '', version: input.base_version + 1, createdAt: existing?.createdAt ?? now, updatedAt: now };
      // Lost-response replay is safe only when the complete intended state still matches.
      if (existing && existing.version === row.version && existing.content === row.content && existing.nextAction === row.nextAction &&
        existing.planId === row.planId && existing.periodStart === row.periodStart && existing.periodEnd === row.periodEnd) return existing;
      return this.repository.saveReflection(row, input.base_version === 0 ? undefined : input.base_version);
    });
  }
  private async requireGoal(owner: LightTickOwner, id: string) {
    if (!await this.repository.getGoal(owner, id))
      throw new ApplicationError(404, 'LIGHTTICK_RESOURCE_NOT_FOUND', 'Goal was not found.');
  }
}
export function reflectionData(row: LightTickReflectionRow) {
  return { id: row.id, goal_id: row.goalId, plan_id: row.planId, period_start: row.periodStart,
    period_end: row.periodEnd, content: row.content, next_action: row.nextAction,
    version: row.version, created_at: row.createdAt, updated_at: row.updatedAt };
}
