import type { LightTickRepository } from "../lighttick.repository.ts";
import type {
  LightTickOwner,
  LightTickGoalRow,
  LightTickPlanRow,
  LightTickTaskRow,
} from "../lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { randomId, sha256 } from "../../../shared/utils.ts";
import { ManualPlanningService, canonical } from "./manual-planning.service.ts";
import { boundedText, dateOnly, invalid } from "./manual-planning.types.ts";
import type { LocalAdoptionInput, LocalClaim } from "./local-adoption.types.ts";

/** An explicit one-way transfer, independently authorized from login and record sync. */
export class LocalAdoptionService {
  private readonly manual: ManualPlanningService;
  constructor(
    private readonly repository: LightTickRepository,
    private readonly clock = () => new Date(),
    assertActive: () => Promise<void> = async () => {},
  ) {
    this.manual = new ManualPlanningService(repository, clock, assertActive);
  }
  async adopt(owner: LightTickOwner, key: string, input: LocalAdoptionInput) {
    this.validate(input);
    return this.manual.operation(owner, key, "local.adopt", input, async () => {
      const now = this.clock().toISOString();
      const entries = [
        ...input.goals.map((value) => ({ kind: "goal", value })),
        ...input.actions.map((value) => ({ kind: "action", value })),
        ...input.reflections.map((value) => ({ kind: "reflection", value })),
      ];
      const hashes = entries.map((e) =>
        sha256(
          `${input.source_secret}:${input.workspace_id}:${e.kind}:${e.value.id}`,
        ),
      );
      for (const hash of [...hashes].sort())
        await this.repository.lockLocalSource(hash);
      const mappings: { kind: string; local_id: string; cloud_id: string }[] =
          [],
        claims: LocalClaim[] = [];
      const ids = new Map<string, string>();
      const fresh = new Set<string>();
      for (const [i, e] of entries.entries()) {
        const hash = hashes[i],
          history = input.events.filter(
            (event) => event.entity_id === e.value.id,
          ),
          source = { ...e.value, history };
        const payloadHash = sha256(canonical(source)),
          prior = await this.repository.getLocalClaim(hash);
        if (prior?.deleted)
          throw new ApplicationError(
            410,
            "LIGHTTICK_RESOURCE_NOT_FOUND",
            "This source was deleted after transfer.",
          );
        if (
          prior &&
          (prior.userId !== owner.userId || prior.payloadHash !== payloadHash)
        )
          throw new ApplicationError(
            409,
            "LIGHTTICK_VERSION_CONFLICT",
            "The local source already belongs to an account or its contents changed.",
          );
        const cloudId =
          prior?.cloudId ??
          randomId(`lighttick_${e.kind === "action" ? "task" : e.kind}`);
        ids.set(`${e.kind}:${e.value.id}`, cloudId);
        mappings.push({
          kind: e.kind,
          local_id: e.value.id,
          cloud_id: cloudId,
        });
        if (!prior) {
          fresh.add(`${e.kind}:${e.value.id}`);
          claims.push({
            sourceHash: hash,
            userId: owner.userId,
            entityType: e.kind,
            cloudId,
            payloadHash,
            sourcePayload: source,
            deleted: false,
          });
        }
      }
      const goalId = (id: string) => ids.get(`goal:${id}`)!;
      for (const g of input.goals)
        if (fresh.has(`goal:${g.id}`)) {
          const status = g.archived
            ? "archived"
            : {
                active: "active",
                paused: "paused",
                achieved: "completed",
                ended: "archived",
              }[g.status];
          const row: LightTickGoalRow = {
            ...owner,
            id: goalId(g.id),
            title: g.title.trim(),
            status,
            constraints: {
              completion_criteria: g.criteria,
              local_status: g.status,
              local_archived: g.archived,
            },
            version: 1,
            createdAt: now,
            updatedAt: now,
          };
          await this.repository.saveGoal(
            row,
            this.manual.write(
              owner,
              "goal",
              row.id,
              1,
              "local_goal_adopted",
              now,
              { status, local_id: g.id },
            ),
          );
        }
      const plans = new Map<string, string>();
      for (const g of input.goals) {
        const actions = input.actions.filter(
          (a) => a.goal_id === g.id && fresh.has(`action:${a.id}`),
        );
        if (!actions.length) continue;
        const dates = actions.flatMap((a) => (a.date ? [a.date] : [])).sort();
        const plan: LightTickPlanRow = {
          ...owner,
          id: randomId("lighttick_plan"),
          goalId: goalId(g.id),
          granularity: "week",
          status: "active",
          source: "local_adoption",
          periodStart: dates[0] ?? now.slice(0, 10),
          periodEnd: dates.at(-1) ?? now.slice(0, 10),
          proposal: { local_source: true },
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        await this.repository.savePlan(
          plan,
          this.manual.write(
            owner,
            "plan",
            plan.id,
            1,
            "local_plan_adopted",
            now,
            { status: "active" },
          ),
        );
        plans.set(g.id, plan.id);
      }
      for (const [position, a] of input.actions.entries())
        if (fresh.has(`action:${a.id}`)) {
          const t: LightTickTaskRow = {
            ...owner,
            id: ids.get(`action:${a.id}`)!,
            goalId: goalId(a.goal_id),
            planId: plans.get(a.goal_id)!,
            title: a.title.trim(),
            status: a.completed_at
              ? "completed"
              : a.archived
                ? "cancelled"
                : "pending",
            priority: input.actions.length - position,
            estimatedMinutes: a.estimated_minutes,
            scheduledFor: a.date ?? undefined,
            completedAt: a.completed_at ?? undefined,
            completionCriteria: a.criteria || undefined,
            notes: a.details || undefined,
            version: 1,
            createdAt: now,
            updatedAt: now,
          };
          await this.repository.saveTask(
            t,
            this.manual.write(
              owner,
              "task",
              t.id,
              1,
              "local_action_adopted",
              now,
              {
                local_id: a.id,
                source_reflection_id: a.source_reflection_id
                  ? (ids.get(`reflection:${a.source_reflection_id}`) ?? null)
                  : null,
                original_completed_at: a.completed_at,
              },
            ),
          );
        }
      for (const r of input.reflections)
        if (fresh.has(`reflection:${r.id}`)) {
          const content =
            [
              r.result && `结果：${r.result}`,
              r.obstacles && `障碍：${r.obstacles}`,
            ]
              .filter(Boolean)
              .join("\n") || "未填写结果或障碍";
          await this.repository.saveReflection({
            ...owner,
            id: ids.get(`reflection:${r.id}`)!,
            goalId: goalId(r.goal_id),
            content,
            nextAction: r.next_step,
            periodStart: r.created_at.slice(0, 10),
            periodEnd: r.created_at.slice(0, 10),
            version: 1,
            createdAt: r.created_at,
            updatedAt: now,
          });
        }
      for (const claim of claims) await this.repository.saveLocalClaim(claim);
      return {
        receipt_id: key,
        owner_id: owner.userId,
        mappings,
        adopted_at: now,
      };
    });
  }
  private validate(p: LocalAdoptionInput) {
    if (
      !p ||
      !boundedText(p.workspace_id, 128, true) ||
      typeof p.source_secret !== "string" ||
      !/^[a-zA-Z0-9-]{32,128}$/.test(p.source_secret) ||
      !Array.isArray(p.goals) ||
      !p.goals.length ||
      p.goals.length > 10 ||
      !Array.isArray(p.actions) ||
      p.actions.length > 250 ||
      !Array.isArray(p.reflections) ||
      p.reflections.length > 500 ||
      !Array.isArray(p.events) ||
      p.events.length > 2000 ||
      Buffer.byteLength(JSON.stringify(p)) > 1_000_000
    )
      invalid("Review a bounded selection and its source proof.");
    const ids = new Set<string>(),
      goals = new Set(p.goals.map((g) => g.id)),
      actions = new Map(p.actions.map((a) => [a.id, a]));
    const id = (v: unknown) => {
      if (!boundedText(v, 128, true) || ids.has(v))
        invalid("Source IDs must be unique.");
      ids.add(v);
    };
    const timestamp = (v: unknown) =>
      typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}T/.test(v) &&
      dateOnly(v.slice(0, 10)) &&
      Number.isFinite(Date.parse(v)) &&
      Date.parse(v) <= this.clock().getTime() + 300000;
    for (const g of p.goals) {
      id(g.id);
      if (
        !boundedText(g.title, 200, true) ||
        !boundedText(g.criteria, 1000) ||
        !["active", "paused", "achieved", "ended"].includes(g.status) ||
        typeof g.archived !== "boolean"
      )
        invalid("Check selected goals.");
    }
    for (const a of p.actions) {
      id(a.id);
      if (
        !goals.has(a.goal_id) ||
        !boundedText(a.title, 200, true) ||
        !boundedText(a.criteria, 1000) ||
        !boundedText(a.details, 1000) ||
        (a.date !== null && !dateOnly(a.date)) ||
        (a.completed_at !== null && !timestamp(a.completed_at)) ||
        (a.estimated_minutes !== null &&
          (!Number.isInteger(a.estimated_minutes) ||
            a.estimated_minutes < 1 ||
            a.estimated_minutes > 1440)) ||
        typeof a.archived !== "boolean"
      )
        invalid("Check action ownership, date and effort.");
    }
    for (const r of p.reflections) {
      id(r.id);
      if (
        !goals.has(r.goal_id) ||
        (r.action_id !== null &&
          actions.get(r.action_id)?.goal_id !== r.goal_id) ||
        ![r.result, r.obstacles].every((t) => boundedText(t, 1800)) ||
        !boundedText(r.next_step, 1000) ||
        !timestamp(r.created_at)
      )
        invalid("Check reflection ownership and history.");
    }
    const reflectionIds = new Set(p.reflections.map((r) => r.id));
    for (const a of p.actions)
      if (
        a.source_reflection_id !== null &&
        !reflectionIds.has(a.source_reflection_id)
      )
        invalid("Include the source reflection in this selection.");
    for (const e of p.events)
      if (
        !ids.has(e.entity_id) ||
        !boundedText(e.id, 128, true) ||
        !boundedText(e.kind, 100, true) ||
        !boundedText(e.value, 10000) ||
        !timestamp(e.created_at)
      )
        invalid("History must belong to the reviewed selection.");
  }
}
