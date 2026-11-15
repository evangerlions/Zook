import { ApplicationError } from "../../../shared/errors.ts";
import { digest } from "../learning/native-learning.validation.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type {
  LightTickOwner,
  LightTickExecutionEventRow,
} from "../lighttick.types.ts";
import type {
  WeeklyFact,
  WeeklyWrite,
  WeeklyTarget,
  TargetRef,
  WeeklyCard,
  WeeklySnapshot,
  WeeklyVersion,
} from "./weekly-card.types.ts";
function fail(status: number, message: string): never {
  throw new ApplicationError(
    status,
    status === 409
      ? "LIGHTTICK_VERSION_CONFLICT"
      : status === 404
        ? "LIGHTTICK_RESOURCE_NOT_FOUND"
        : "VALIDATION_ERROR",
    message,
  );
}
function date(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.slice(0, 4) !== "0000" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v
  );
}
export function mondayOf(d: string) {
  if (!date(d)) fail(422, "请选择有效日期。");
  const n = new Date(d);
  n.setUTCDate(n.getUTCDate() - ((n.getUTCDay() + 6) % 7));
  return n.toISOString().slice(0, 10);
}
const add = (d: string, n: number) =>
  new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
export function weeklyFacts(
  events: LightTickExecutionEventRow[],
  week: string,
  zone: string,
  now: Date,
) {
  const end = add(week, 6),
    seen = new Set<string>(),
    facts: WeeklyFact[] = [];
  for (const e of events) {
    if (
      e.aggregateType !== "task" ||
      seen.has(e.id) ||
      !Number.isFinite(Date.parse(e.occurredAt)) ||
      Date.parse(e.occurredAt) > +now
    )
      continue;
    const p = e.payload,
      kind =
        e.eventType === "task_complete" &&
        p.action === "complete" &&
        p.valid_action === true
          ? "completed"
          : e.eventType === "task_minimum_step_recorded" &&
              p.action === "minimum_step" &&
              p.valid_action === true &&
              p.task_completed === false
            ? "minimum"
            : null;
    if (!kind) continue;
    const day = businessDateAt(new Date(e.occurredAt), zone);
    if (day < week || day > end) continue;
    seen.add(e.id);
    facts.push({
      id: e.id,
      task_id: e.aggregateId,
      task_version: e.aggregateVersion,
      kind,
      title: typeof p.title === "string" ? p.title : "已保存的任务行动",
      note:
        kind === "minimum"
          ? String(p.minimum_step ?? "")
          : typeof p.notes === "string"
            ? p.notes
            : "",
      activity_at: e.occurredAt,
      activity_date: day,
    });
  }
  return facts.sort(
    (a, b) =>
      b.activity_at.localeCompare(a.activity_at) || a.id.localeCompare(b.id),
  );
}
function exact(b: any, fields: string[]) {
  if (
    !b ||
    typeof b !== "object" ||
    Array.isArray(b) ||
    Object.keys(b).length !== fields.length ||
    Object.keys(b).some((k) => !fields.includes(k))
  )
    fail(422, "周卡字段无效。");
}
export function validateWeeklyWrite(b: any): WeeklyWrite {
  exact(b, [
    "base_revision",
    "snapshot_hash",
    "selected_fact_ids",
    "review_text",
    "adjustment_text",
    "adjustment_target",
  ]);
  if (
    !Number.isSafeInteger(b.base_revision) ||
    b.base_revision < 0 ||
    b.base_revision > 2147483647 ||
    typeof b.snapshot_hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(b.snapshot_hash) ||
    !Array.isArray(b.selected_fact_ids) ||
    b.selected_fact_ids.length > 3 ||
    new Set(b.selected_fact_ids).size !== b.selected_fact_ids.length ||
    b.selected_fact_ids.some(
      (v: any) => typeof v !== "string" || !v || v.length > 160,
    ) ||
    typeof b.review_text !== "string" ||
    b.review_text.length > 2000 ||
    typeof b.adjustment_text !== "string" ||
    b.adjustment_text.length > 500
  )
    fail(422, "最多选择三条不同的成果；回看限2000字，调整限500字。");
  if (b.adjustment_target !== null) {
    const t = b.adjustment_target;
    exact(t, [
      "task_id",
      "task_version",
      "plan_id",
      "plan_version",
      "goal_id",
      "goal_version",
    ]);
    if (
      !b.adjustment_text.trim() ||
      ["task_id", "plan_id", "goal_id"].some(
        (k) => typeof t[k] !== "string" || !t[k] || t[k].length > 160,
      ) ||
      ["task_version", "plan_version", "goal_version"].some(
        (k) => !Number.isSafeInteger(t[k]) || t[k] < 1,
      )
    )
      fail(422, "关联行动需填写调整，并核对任务、计划和目标版本。");
  }
  return b;
}
const targetRef = (t: TargetRef) => ({
  task_id: t.task_id,
  task_version: t.task_version,
  plan_id: t.plan_id,
  plan_version: t.plan_version,
  goal_id: t.goal_id,
  goal_version: t.goal_version,
});
export class WeeklyCardService {
  constructor(
    private readonly repo: LightTickRepository,
    private readonly clock = () => new Date(),
    private readonly authorize = async () => {},
  ) {}
  private get store() {
    if (!this.repo.weeklyCards) fail(503, "周回看暂不可用。");
    return this.repo.weeklyCards;
  }
  private async targets(o: LightTickOwner, now: Date) {
    const zone = (await this.repo.getProfile(o))?.timezone ?? "UTC",
      today = businessDateAt(now, zone),
      plans = new Map(
        (await this.repo.listPlans(o))
          .filter((p) => p.status === "active")
          .map((p) => [p.id, p]),
      ),
      goals = new Map((await this.repo.listGoals(o)).map((g) => [g.id, g]));
    const targets: WeeklyTarget[] = [];
    for (const t of await this.repo.listTasks(o)) {
      const p = plans.get(t.planId),
        g = goals.get(t.goalId);
      if (
        !p ||
        !g ||
        p.goalId !== g.id ||
        !["pending", "in_progress"].includes(t.status) ||
        !(
          g.status === "active" ||
          (g.status === "recovering" &&
            (t.selectedVariant ?? "standard") !== "standard")
        ) ||
        !t.scheduledFor
      )
        continue;
      const day = date(t.scheduledFor)
        ? t.scheduledFor
        : Number.isFinite(Date.parse(t.scheduledFor))
          ? businessDateAt(new Date(t.scheduledFor), zone)
          : "";
      if (!day || day < today) continue;
      targets.push({
        task_id: t.id,
        task_version: t.version,
        plan_id: p.id,
        plan_version: p.version,
        goal_id: g.id,
        goal_version: g.version,
        title: t.title,
        scheduled_date: day,
      });
    }
    return {
      targets: targets.sort(
        (a, b) =>
          a.scheduled_date.localeCompare(b.scheduled_date) ||
          a.task_id.localeCompare(b.task_id),
      ),
      today,
      zone,
    };
  }
  private async projection(o: LightTickOwner, week: string, now: Date) {
    if (mondayOf(week) !== week) fail(422, "请选择周一作为周起始日期。");
    const card = await this.store.get(o, week),
      zone =
        card?.timezone ?? (await this.repo.getProfile(o))?.timezone ?? "UTC",
      today = businessDateAt(now, zone);
    if (week > today) fail(422, "未来周尚无回看。");
    const end = add(week, 6),
      events = await this.repo.listExecutionEvents(
        o,
        new Date(
          Math.max(Date.parse(week) - 2 * 86400000, Date.parse("0001-01-01")),
        ).toISOString(),
        new Date(Date.parse(end) + 3 * 86400000).toISOString(),
      ),
      facts = weeklyFacts(events, week, zone, now);
    if (
      facts.length > 500 ||
      Buffer.byteLength(JSON.stringify(facts)) > 1024 * 1024
    )
      fail(409, "本周事实超过500条或1MiB，未显示或确认不完整周卡。");
    const stats = {
      completed_count: facts.filter((f) => f.kind === "completed").length,
      minimum_count: facts.filter((f) => f.kind === "minimum").length,
      action_days: new Set(facts.map((f) => f.activity_date)).size,
    };
    const snapshot: WeeklySnapshot = {
      week_start: week,
      week_end: end,
      as_of: today < end ? today : end,
      is_partial: today <= end,
      timezone: zone,
      stats,
      facts,
      snapshot_hash: digest({ week_start: week, timezone: zone, stats, facts }),
    };
    return { snapshot, card };
  }
  private async followUp(
    o: LightTickOwner,
    card: WeeklyCard | undefined,
    now: Date,
  ) {
    const target = card?.adjustment_target;
    if (!card || !target) return null;
    const task = await this.repo.getTask(o, target.task_id);
    if (!task)
      return {
        task_id: target.task_id,
        title: target.title,
        status: "unavailable",
        scheduled_date: null,
        changed: true,
        completed_after_confirmation: false,
        minimum_attempts_after_confirmation: 0,
      };
    const events = (
      await this.repo.listExecutionEvents(
        o,
        card.confirmed_at,
        new Date(+now + 1).toISOString(),
      )
    ).filter(
      (e) =>
        e.aggregateType === "task" &&
        e.aggregateId === task.id &&
        e.aggregateVersion > target.task_version &&
        Date.parse(e.occurredAt) >= Date.parse(card.confirmed_at) &&
        Date.parse(e.occurredAt) <= +now,
    );
    const completed = events.some(
        (e) =>
          e.eventType === "task_complete" &&
          e.payload.action === "complete" &&
          e.payload.valid_action === true,
      ),
      minimum = events.filter(
        (e) =>
          e.eventType === "task_minimum_step_recorded" &&
          e.payload.action === "minimum_step" &&
          e.payload.valid_action === true &&
          e.payload.task_completed === false,
      ).length;
    const g = await this.repo.getGoal(o, task.goalId),
      p = await this.repo.getPlan(o, task.planId),
      zone = (await this.repo.getProfile(o))?.timezone ?? "UTC";
    const scheduled = task.scheduledFor
      ? date(task.scheduledFor)
        ? task.scheduledFor
        : businessDateAt(new Date(task.scheduledFor), zone)
      : null;
    return {
      task_id: task.id,
      title: task.title,
      status:
        !g ||
        !p ||
        !["active", "recovering"].includes(g.status) ||
        p.status !== "active"
          ? "unavailable"
          : task.status,
      scheduled_date: scheduled,
      changed:
        task.version !== target.task_version ||
        g?.version !== target.goal_version ||
        p?.version !== target.plan_version,
      completed_after_confirmation: completed,
      minimum_attempts_after_confirmation: minimum,
    };
  }
  async read(o: LightTickOwner, week?: string, q = "") {
    if (q.length > 100) fail(422, "行动搜索限100字。");
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const now = this.clock(),
        zone = (await this.repo.getProfile(o))?.timezone ?? "UTC",
        w = week ?? mondayOf(businessDateAt(now, zone)),
        { snapshot, card } = await this.projection(o, w, now),
        options = await this.targets(o, now),
        matching = options.targets.filter((t) =>
          t.title.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase()),
        );
      return {
        ...snapshot,
        card: card ?? null,
        changed: !!card && card.snapshot_hash !== snapshot.snapshot_hash,
        targets: matching.slice(0, 100),
        targets_more: matching.length > 100,
        current_date: options.today,
        current_timezone: options.zone,
        follow_up: await this.followUp(o, card, now),
        saved_weeks: await this.store.list(o),
      };
    });
  }
  async confirm(o: LightTickOwner, week: string, key: string, input: unknown) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key))
      fail(422, "请提供有效原请求标识。");
    const b = validateWeeklyWrite(input);
    if (mondayOf(week) !== week) fail(422, "周起始日期必须是周一。");
    return this.repo.transaction(o, async () => {
      await this.repo.lockPlanningOwner(o);
      await this.authorize();
      const op = "weekly-card:" + key,
        hash = digest({ week, ...b }),
        prior = await this.repo.getOperation(o, op);
      if (prior) {
        if (prior.payloadHash !== hash || prior.entityId !== week)
          fail(409, "原请求内容不同，请先恢复原请求。");
        return prior.resultPayload as unknown as WeeklyCard;
      }
      const now = this.clock(),
        { snapshot, card: old } = await this.projection(o, week, now);
      if (
        (old?.revision ?? 0) !== b.base_revision ||
        snapshot.snapshot_hash !== b.snapshot_hash
      )
        fail(409, "本周事实或周卡版本已变化，请保留选择并重新回看。");
      if (
        b.selected_fact_ids.some(
          (id) => !snapshot.facts.some((f) => f.id === id),
        )
      )
        fail(422, "请选择本周仍有效的成果。");
      let target: WeeklyTarget | null = null;
      if (b.adjustment_target) {
        target =
          (await this.targets(o, now)).targets.find(
            (t) => t.task_id === b.adjustment_target!.task_id,
          ) ?? null;
        if (
          !target ||
          digest(targetRef(target)) !== digest(b.adjustment_target)
        )
          fail(
            409,
            "关联行动已变更、停用或不是今天/未来可执行行动，请重新核对。",
          );
      }
      if (b.base_revision >= 2147483647 || (old?.history.length ?? 0) >= 19)
        fail(409, "周卡已达到20版或修订上限，原版本仍可读取。");
      const { history: _history, ...previous } = old ?? { history: [] };
      const result: WeeklyCard = {
        ...snapshot,
        revision: b.base_revision + 1,
        confirmed_at: now.toISOString(),
        selected_fact_ids: [...b.selected_fact_ids],
        review_text: b.review_text.trim(),
        adjustment_text: b.adjustment_text.trim(),
        adjustment_target: target,
        history: old ? [...old.history, previous as WeeklyVersion] : [],
      };
      if (Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024)
        fail(409, "周卡历史超过4MiB，未截断原版本。");
      await this.store.save(o, result, b.base_revision);
      await this.repo.saveOperation({
        ...o,
        operationId: op,
        deviceId: "http",
        payloadHash: hash,
        entityType: "weekly-card",
        entityId: week,
        action: "confirm",
        requestPayload: b as unknown as Record<string, unknown>,
        resultPayload: result as unknown as Record<string, unknown>,
        status: "accepted",
        createdAt: result.confirmed_at,
        updatedAt: result.confirmed_at,
      });
      return result;
    });
  }
}
