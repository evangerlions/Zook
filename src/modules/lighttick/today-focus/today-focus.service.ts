import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { LightTickTodayService } from "../lighttick-today.service.ts";
import type { TodayFocusSnapshot } from "./today-focus.types.ts";
import { digest } from "../learning/native-learning.validation.ts";
import { ApplicationError } from "../../../shared/errors.ts";
const invalid = (message: string) =>
  new ApplicationError(422, "VALIDATION_ERROR", message);
const conflict = () =>
  new ApplicationError(
    409,
    "LIGHTTICK_VERSION_CONFLICT",
    "今日焦点或任务已变化，请刷新核对。",
  );
export class TodayFocusService {
  constructor(
    private readonly repo: LightTickRepository,
    private readonly today: LightTickTodayService,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  private key(value: unknown) {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,160}$/.test(value))
      throw invalid("请求编号无效。");
    return value;
  }
  async current(o: LightTickOwner): Promise<TodayFocusSnapshot> {
    return this.repo.transaction(o, async () => {
      const today = await this.today.get(o),
        row = await this.repo.todayFocus.get(o, today.businessDate);
      if (!row)
        return {
          business_date: today.businessDate,
          timezone: today.timezone,
          revision: 0,
          task_id: null,
          task_version: null,
          title: "",
          success_criterion: "",
          first_step: "",
          selected_at: null,
          status: "automatic",
        };
      const { appId, userId, ...data } = row,
        task = row.task_id
          ? await this.repo.getTask(o, row.task_id)
          : undefined;
      return {
        ...data,
        timezone: today.timezone,
        task_version: task?.version ?? null,
        status: !row.task_id
          ? "automatic"
          : row.timezone !== today.timezone
            ? "unavailable"
            : task?.status === "completed"
              ? "completed"
              : today.executableTasks.some((t) => t.id === row.task_id)
                ? "active"
                : "unavailable",
      };
    });
  }
  async byRequest(o: LightTickOwner, key: string) {
    this.key(key);
    const op = await this.repo.getOperation(o, "today-focus:" + key);
    if (!op)
      throw new ApplicationError(
        404,
        "LIGHTTICK_RESOURCE_NOT_FOUND",
        "焦点请求尚未提交。",
      );
    return op.resultPayload as unknown as TodayFocusSnapshot;
  }
  async select(
    o: LightTickOwner,
    b: Record<string, unknown>,
    assertActive: () => Promise<void> = async () => {},
  ): Promise<TodayFocusSnapshot> {
    const key = this.key(b.request_key);
    if (
      Object.keys(b).some(
        (k) =>
          ![
            "request_key",
            "base_version",
            "business_date",
            "timezone",
            "task_id",
            "task_version",
            "success_criterion",
            "first_step",
          ].includes(k),
      )
    )
      throw invalid("未知的焦点字段。");
    if (
      !Number.isSafeInteger(b.base_version) ||
      (b.base_version as number) < 0 ||
      typeof b.business_date !== "string" ||
      typeof b.timezone !== "string" ||
      (b.task_id !== null &&
        (typeof b.task_id !== "string" || b.task_id.length > 160)) ||
      (b.task_id !== null &&
        (!Number.isSafeInteger(b.task_version) ||
          (b.task_version as number) < 1)) ||
      (b.task_id === null && b.task_version !== null)
    )
      throw invalid("焦点日期、版本或任务无效。");
    for (const field of ["success_criterion", "first_step"])
      if (typeof b[field] !== "string" || (b[field] as string).length > 500)
        throw invalid("完成标准与第一步各限 500 字。");
    return this.repo.transaction(o, async () => {
      await assertActive();
      const hash = digest(b),
        prior = await this.repo.getOperation(o, "today-focus:" + key);
      if (prior) {
        if (prior.payloadHash !== hash) throw conflict();
        return prior.resultPayload as unknown as TodayFocusSnapshot;
      }
      const today = await this.today.get(o);
      if (
        today.businessDate !== b.business_date ||
        today.timezone !== b.timezone
      )
        throw conflict();
      const old = await this.repo.todayFocus.get(o, today.businessDate);
      if ((old?.revision ?? 0) !== b.base_version) throw conflict();
      const task =
        b.task_id === null
          ? undefined
          : today.executableTasks.find((t) => t.id === b.task_id);
      if (b.task_id !== null && (!task || task.version !== b.task_version))
        throw conflict();
      const now = this.clock().toISOString(),
        row = {
          ...o,
          business_date: today.businessDate,
          timezone: today.timezone,
          revision: (b.base_version as number) + 1,
          task_id: task?.id ?? null,
          title: task?.title ?? "",
          success_criterion: task ? (b.success_criterion as string).trim() : "",
          first_step: task ? (b.first_step as string).trim() : "",
          selected_at: now,
        };
      await this.repo.todayFocus.save(row, b.base_version as number);
      const { appId, userId, ...data } = row;
      const result: TodayFocusSnapshot = {
        ...data,
        task_version: task?.version ?? null,
        status: task ? "active" : "automatic",
      };
      await this.repo.saveOperation({
        ...o,
        operationId: "today-focus:" + key,
        deviceId: "today-focus",
        payloadHash: hash,
        entityType: "today-focus",
        entityId: today.businessDate,
        action: "select",
        requestPayload: b,
        resultPayload: result as unknown as Record<string, unknown>,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return result;
    });
  }
}
