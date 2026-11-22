import { digest as hash } from "../learning/native-learning.validation.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import {
  defaultFocusPreferences,
  elapsedFocusMs,
  projectFocus,
  type FocusReceipt,
  type FocusRow,
  type FocusPreferences,
} from "./focus.types.ts";
const invalid = (message: string) =>
  new ApplicationError(400, "REQ_FIELD_INVALID", message);
const conflict = (message = "计时状态已变化，请刷新核对。") =>
  new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", message);
const integer = (v: unknown, min: number, max: number) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    throw invalid(`数值应为 ${min}–${max} 的整数。`);
  return v;
};
const text = (v: unknown, max: number) => {
  if (typeof v !== "string" || v.length > max)
    throw invalid("文本格式或长度无效。");
  return v.trim();
};
function keys(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((k) => !allowed.includes(k)))
    throw invalid("请求含未知字段。");
}
export class FocusService {
  constructor(
    readonly repo: LightTickRepository,
    readonly clock = () => new Date(),
    private readonly authorize: () => Promise<void> = async () => {},
  ) {}
  private key(input: Record<string, unknown>) {
    const key = text(input.request_key ?? "", 160);
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(key))
      throw invalid("计时请求编号无效。");
    return key;
  }
  private async receipt(
    o: LightTickOwner,
    now: Date,
    row?: FocusRow,
    prefs?: FocusPreferences,
  ): Promise<FocusReceipt> {
    const preferences =
      prefs ??
      (await this.repo.focus.preferences(o)) ??
      defaultFocusPreferences();
    return {
      server_time: now.toISOString(),
      session: row ? projectFocus(row, now, preferences) : null,
      preferences,
    };
  }
  private async write(
    o: LightTickOwner,
    path: string,
    input: Record<string, unknown>,
    run: (now: Date) => Promise<FocusReceipt>,
  ) {
    const key = this.key(input),
      payloadHash = hash({ path, input });
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const previous = await this.repo.getOperation(o, "focus:" + key);
      if (previous) {
        if (previous.payloadHash !== payloadHash)
          throw conflict("同一请求编号不能用于不同计时操作。");
        return previous.resultPayload as unknown as FocusReceipt;
      }
      const now = this.clock(),
        result = await run(now);
      await this.repo.saveOperation({
        ...o,
        operationId: "focus:" + key,
        deviceId: "focus",
        payloadHash,
        entityType: "focus",
        entityId: result.session?.id ?? "preferences",
        action: path,
        requestPayload: input,
        resultPayload: result as unknown as Record<string, unknown>,
        status: "accepted",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      return result;
    });
  }
  async current(o: LightTickOwner) {
    return this.repo.transaction(o, async () =>
      this.receipt(o, this.clock(), await this.repo.focus.active(o)),
    );
  }
  async byRequest(o: LightTickOwner, key: string) {
    this.key({ request_key: key });
    const op = await this.repo.getOperation(o, "focus:" + key);
    if (!op)
      throw new ApplicationError(
        404,
        "LIGHTTICK_RESOURCE_NOT_FOUND",
        "计时请求收据不存在。",
      );
    return op.resultPayload as unknown as FocusReceipt;
  }
  async get(o: LightTickOwner, id: string) {
    const row = await this.repo.focus.get(o, id);
    if (!row)
      throw new ApplicationError(
        404,
        "LIGHTTICK_RESOURCE_NOT_FOUND",
        "计时记录不存在。",
      );
    return this.receipt(o, this.clock(), row);
  }
  async start(o: LightTickOwner, input: Record<string, unknown>) {
    keys(input, ["request_key", "kind", "title", "planned_seconds"]);
    const kind = input.kind;
    if (kind !== "focus" && kind !== "break")
      throw invalid("请选择专注或休息。");
    const title = text(
      input.title ?? (kind === "focus" ? "专注" : "休息"),
      200,
    );
    if (!title) throw invalid("请写下本次要做的事。");
    if (input.planned_seconds !== undefined)
      integer(input.planned_seconds, 60, kind === "focus" ? 10800 : 3600);
    return this.write(o, "start", input, async (now) => {
      if (await this.repo.focus.active(o))
        throw conflict("已有专注或休息计时，请先保存或作废当前会话。");
      const preferences =
          (await this.repo.focus.preferences(o)) ?? defaultFocusPreferences(),
        timezone = (await this.repo.getProfile(o))?.timezone ?? "UTC";
      const row: FocusRow = {
        ...o,
        id: "focus_session_" + hash([o, this.key(input)]).slice(0, 40),
        revision: 1,
        kind,
        title,
        planned_seconds: Number(
          input.planned_seconds ??
            (kind === "focus"
              ? preferences.focus_minutes
              : preferences.break_minutes) * 60,
        ),
        status: "running",
        accumulated_ms: 0,
        segment_started_at: now.toISOString(),
        actual_seconds: null,
        notes: "",
        timezone,
        business_date: businessDateAt(now, timezone),
        started_at: now.toISOString(),
        finished_at: null,
        reminder_snoozed_until: null,
        reminder_dismissed: false,
      };
      await this.repo.focus.save(row, 0);
      return this.receipt(o, now, row, preferences);
    });
  }
  async preferences(o: LightTickOwner, input: Record<string, unknown>) {
    keys(input, [
      "request_key",
      "base_version",
      "focus_minutes",
      "break_minutes",
      "reminders_enabled",
    ]);
    integer(input.base_version, 0, 2147483647);
    const focus = integer(input.focus_minutes, 1, 180),
      rest = integer(input.break_minutes, 1, 60);
    if (typeof input.reminders_enabled !== "boolean")
      throw invalid("提醒设置必须为布尔值。");
    return this.write(o, "preferences", input, async (now) => {
      const current =
        (await this.repo.focus.preferences(o)) ?? defaultFocusPreferences();
      if (input.base_version !== current.revision) throw conflict();
      const next = {
        revision: current.revision + 1,
        focus_minutes: focus,
        break_minutes: rest,
        reminders_enabled: input.reminders_enabled as boolean,
        updated_at: now.toISOString(),
      };
      await this.repo.focus.savePreferences(o, next, current.revision);
      return this.receipt(o, now, await this.repo.focus.active(o), next);
    });
  }
  async command(o: LightTickOwner, id: string, input: Record<string, unknown>) {
    keys(input, [
      "request_key",
      "base_version",
      "action",
      "actual_seconds",
      "notes",
    ]);
    integer(input.base_version, 1, 2147483647);
    const action = input.action;
    if (
      ![
        "pause",
        "resume",
        "finish",
        "discard",
        "snooze",
        "dismiss_reminder",
      ].includes(String(action))
    )
      throw invalid("计时操作无效。");
    if (
      action !== "finish" &&
      (input.actual_seconds !== undefined || input.notes !== undefined)
    )
      throw invalid("只有结束保存时才能提交投入和笔记。");
    return this.write(o, id + ":" + action, input, async (now) => {
      const row = await this.repo.focus.get(o, id);
      if (!row)
        throw new ApplicationError(
          404,
          "LIGHTTICK_RESOURCE_NOT_FOUND",
          "计时记录不存在。",
        );
      if (input.base_version !== row.revision) throw conflict();
      if (!["running", "paused"].includes(row.status))
        throw conflict("这轮计时已经结束。");
      const elapsed = elapsedFocusMs(row, now),
        next = { ...row, revision: row.revision + 1 };
      if (action === "pause") {
        if (row.status !== "running") throw conflict();
        next.status = "paused";
        next.accumulated_ms = elapsed;
        next.segment_started_at = null;
      }
      if (action === "resume") {
        if (row.status !== "paused") throw conflict();
        next.status = "running";
        next.segment_started_at = now.toISOString();
      }
      if (action === "finish") {
        next.actual_seconds = integer(
          input.actual_seconds,
          0,
          Math.floor(elapsed / 1000),
        );
        next.notes = text(input.notes ?? "", 2000);
        next.status = "saved";
      }
      if (action === "discard") next.status = "discarded";
      if (action === "finish" || action === "discard") {
        next.accumulated_ms = elapsed;
        next.segment_started_at = null;
        next.finished_at = now.toISOString();
      }
      if (action === "snooze" || action === "dismiss_reminder") {
        if (elapsed < row.planned_seconds * 1000)
          throw invalid("计时目标尚未到达。");
        if (action === "snooze") {
          next.reminder_snoozed_until = new Date(
            now.getTime() + 300000,
          ).toISOString();
          next.reminder_dismissed = false;
        } else next.reminder_dismissed = true;
      }
      await this.repo.focus.save(next, row.revision);
      return this.receipt(o, now, next);
    });
  }
  async history(o: LightTickOwner, q: Record<string, string | undefined>) {
    const page = integer(Number(q.page ?? 1), 1, 1000000),
      size = integer(Number(q.page_size ?? 20), 1, 50),
      kind = q.kind ?? "all";
    if (!["all", "focus", "break"].includes(kind))
      throw invalid("记录类型无效。");
    return this.repo.transaction(o, async () => {
      const now = this.clock(),
        prefs =
          (await this.repo.focus.preferences(o)) ?? defaultFocusPreferences(),
        result = await this.repo.focus.history(
          o,
          (page - 1) * size,
          size,
          kind,
        );
      return {
        ...result,
        items: result.items.map((r) => projectFocus(r, now, prefs)),
        page,
        page_size: size,
      };
    });
  }
}
