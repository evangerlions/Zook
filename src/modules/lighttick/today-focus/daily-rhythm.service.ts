import { randomUUID } from "node:crypto";
import { ApplicationError } from "../../../shared/errors.ts";
import { digest } from "../learning/native-learning.validation.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import { LightTickTodayService } from "../lighttick-today.service.ts";
import { TodayFocusService } from "./today-focus.service.ts";
import type { TodayFocusRow } from "./today-focus.types.ts";
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
export function validateRhythmCommand(b: any) {
  const common = [
      "request_key",
      "base_version",
      "business_date",
      "timezone",
      "task_id",
      "task_version",
    ],
    extra =
      b?.action === "mode"
        ? ["action", "mode", "minimum_step"]
        : ["action", "confirmed"];
  if (
    !b ||
    typeof b !== "object" ||
    Array.isArray(b) ||
    Object.keys(b).length !== common.length + extra.length ||
    Object.keys(b).some((k) => ![...common, ...extra].includes(k)) ||
    typeof b.request_key !== "string" ||
    !/^[a-zA-Z0-9_-]{8,160}$/.test(b.request_key) ||
    !Number.isSafeInteger(b.base_version) ||
    b.base_version < 0 ||
    typeof b.business_date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.business_date) ||
    typeof b.timezone !== "string" ||
    b.timezone.length > 100 ||
    (b.task_id !== null &&
      (typeof b.task_id !== "string" || b.task_id.length > 160)) ||
    (b.task_id === null
      ? b.task_version !== null
      : !Number.isSafeInteger(b.task_version) || b.task_version < 1)
  )
    fail(422, "节奏日期、原请求或版本无效。");
  if (b.action === "mode") {
    if (
      !["standard", "minimum", "rest"].includes(b.mode) ||
      typeof b.minimum_step !== "string" ||
      b.minimum_step.length > 500 ||
      (b.mode === "minimum" ? !b.minimum_step.trim() : b.minimum_step !== "")
    )
      fail(422, "最小一步需填写1至500字；其他模式不携带最小一步。");
  } else if (b.action !== "attempt" || b.confirmed !== true)
    fail(422, "请明确确认实际做过这一步。");
  return b as Record<string, any>;
}
export class DailyRhythmService {
  constructor(
    private readonly repo: LightTickRepository,
    private readonly clock = () => new Date(),
    private readonly authorize = async () => {},
  ) {}
  async history(o: LightTickOwner, date: string) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      fail(422, "回看日期无效。");
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const row = await this.repo.todayFocus.get(o, date);
      if (!row) return null;
      const { appId, userId, ...view } = row;
      return {
        ...view,
        mode: row.mode ?? "standard",
        minimum_step: row.minimum_step ?? "",
        attempts: row.attempts ?? [],
      };
    });
  }
  async command(o: LightTickOwner, input: unknown) {
    const b = validateRhythmCommand(input);
    return this.repo.transaction(o, async () => {
      await this.repo.lockPlanningOwner(o);
      await this.authorize();
      const hash = digest(b),
        key = "today-rhythm:" + b.request_key,
        prior = await this.repo.getOperation(o, key);
      if (prior) {
        if (prior.payloadHash !== hash || prior.action !== b.action)
          fail(409, "原请求内容不同，请恢复原请求。");
        return prior.resultPayload;
      }
      const instant = this.clock(),
        todayService = new LightTickTodayService(this.repo, () => instant),
        focus = new TodayFocusService(this.repo, todayService, () => instant);
      const today = await todayService.get(o),
        current = await focus.current(o);
      if (
        today.businessDate !== b.business_date ||
        today.timezone !== b.timezone ||
        current.revision !== b.base_version ||
        current.task_id !== b.task_id ||
        current.task_version !== b.task_version
      )
        fail(409, "今日焦点、时区、日期或任务版本已变化，请核对后再提交。");
      const old = await this.repo.todayFocus.get(o, today.businessDate),
        stamp = instant.toISOString();
      let row: TodayFocusRow = {
        ...o,
        business_date: today.businessDate,
        timezone: today.timezone,
        revision: current.revision + 1,
        task_id: current.task_id,
        title: current.title,
        success_criterion: current.success_criterion,
        first_step: current.first_step,
        selected_at: current.selected_at ?? stamp,
        mode: old?.mode ?? "standard",
        minimum_step: old?.minimum_step ?? "",
        attempts: old?.attempts ?? [],
      };
      if (old && old.timezone !== today.timezone)
        fail(409, "原焦点时区已改变，请重新选择焦点。");
      if (b.action === "mode") {
        if (b.mode === "rest") {
          if (
            (await this.repo.listTasks(o)).some(
              (t) => t.status === "in_progress",
            ) ||
            (await this.repo.focus.active(o))
          )
            fail(409, "请先结束或妥善保存正在执行的任务和专注/休息计时。");
        } else if (current.status !== "active")
          fail(409, "请先选择仍可执行的今日焦点。");
        row = {
          ...row,
          mode: b.mode,
          minimum_step: b.mode === "minimum" ? b.minimum_step.trim() : "",
        };
      } else {
        if (
          row.mode !== "minimum" ||
          !row.minimum_step ||
          current.status !== "active"
        )
          fail(409, "请先确认今天的最小一步和可执行焦点。");
        if (row.attempts!.length >= 100)
          fail(409, "今日最小一步记录已达100条。");
        const task = await this.repo.getTask(o, row.task_id!);
        if (
          !task ||
          !["pending", "in_progress"].includes(task.status) ||
          task.version !== b.task_version
        )
          fail(409, "任务已变化。");
        const id = randomUUID(),
          version = task.version + 1;
        await this.repo.saveTask(
          { ...task, updatedAt: stamp },
          {
            event: {
              ...o,
              id,
              aggregateType: "task",
              aggregateId: task.id,
              aggregateVersion: version,
              eventType: "task_minimum_step_recorded",
              payload: {
                action: "minimum_step",
                minimum_step: row.minimum_step,
                business_date: today.businessDate,
                timezone: today.timezone,
                title: task.title,
                valid_action: true,
                task_completed: false,
                commitment_satisfied: false,
              },
              occurredAt: stamp,
              createdAt: stamp,
            },
            change: {
              ...o,
              entityType: "task",
              entityId: task.id,
              entityVersion: version,
              operation: "upsert",
              snapshot: {
                id: task.id,
                status: task.status,
                version,
                scheduled_for: task.scheduledFor ?? null,
              },
              changedAt: stamp,
            },
          },
          task.version,
        );
        row.attempts = [
          ...row.attempts!,
          {
            id,
            task_id: task.id,
            task_version: version,
            step: row.minimum_step,
            recorded_at: stamp,
          },
        ];
      }
      await this.repo.todayFocus.save(row, current.revision);
      const result = await focus.current(o);
      await this.repo.saveOperation({
        ...o,
        operationId: key,
        deviceId: "http",
        payloadHash: hash,
        entityType: "today-rhythm",
        entityId: today.businessDate,
        action: b.action,
        requestPayload: b,
        resultPayload: result as unknown as Record<string, unknown>,
        status: "accepted",
        createdAt: stamp,
        updatedAt: stamp,
      });
      return result;
    });
  }
}
