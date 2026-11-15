import { collectBehaviorReportFacts } from "../behavior/behavior-report.facts.ts";
import { createHash } from "node:crypto";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { JobQueue } from "../../../infrastructure/queue/job-queue.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { captureModel } from "../personal-model/personal-model.service.ts";
import { collectAccountReportFacts } from "./account-report.facts.ts";
import {
  ACCOUNT_REPORT_JOB,
  ACCOUNT_REPORT_SCENE,
  publicReport,
  type AccountReportRow,
} from "./account-report.types.ts";
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const invalid = (message: string) =>
  new ApplicationError(400, "REQ_FIELD_INVALID", message);
export const reportMissing = () =>
  new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "账户报告不存在。");
export class AccountReportService {
  constructor(
    readonly repo: LightTickRepository,
    readonly queue?: Pick<JobQueue, "add">,
    readonly authorizeAI: () => Promise<void> = async () => {},
    readonly clock = () => new Date(),
    readonly collect = collectAccountReportFacts,
    readonly topic: "account" | "behavior" = "account",
  ) {}
  private identity(o: LightTickOwner, key: string) {
    if (!/^[a-zA-Z0-9_-]{8,160}$/.test(key))
      throw invalid("报告请求编号无效。");
    return (
      "account_report_" +
      digest(this.topic === "account" ? [o, key] : [o, key, this.topic]).slice(
        0,
        40,
      )
    );
  }
  async get(o: LightTickOwner, id: string) {
    const row = await this.repo.accountReports.get(o, id);
    if (!row || (row.topic ?? "account") !== this.topic) throw reportMissing();
    return publicReport(row);
  }
  async byRequest(o: LightTickOwner, key: string) {
    return this.get(o, this.identity(o, key));
  }
  async list(o: LightTickOwner, q: Record<string, string | undefined>) {
    const page = Number(q.page ?? 1),
      size = Number(q.page_size ?? 20);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000000 ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > 50
    )
      throw invalid("报告分页无效。");
    return this.repo.transaction(o, async () => {
      const result = await this.repo.accountReports.list(
        o,
        (page - 1) * size,
        size,
        this.topic,
      );
      return {
        ...result,
        items: result.items,
        page,
        page_size: size,
      };
    });
  }
  async create(o: LightTickOwner, input: Record<string, unknown>) {
    for (const key of Object.keys(input))
      if (!["request_key", "period_days", "mode", "retry_of"].includes(key))
        throw invalid("报告请求含未知字段。");
    const key = typeof input.request_key === "string" ? input.request_key : "",
      id = this.identity(o, key),
      days = input.period_days ?? 30,
      mode = input.mode ?? "facts",
      retry = input.retry_of ?? null;
    if (
      !Number.isInteger(days) ||
      Number(days) < 7 ||
      Number(days) > 365 ||
      !["facts", "ai"].includes(String(mode)) ||
      (retry !== null &&
        (typeof retry !== "string" ||
          !/^account_report_[a-f0-9]{40}$/.test(retry)))
    )
      throw invalid("周期为 7–365 天，报告类型应为 facts 或 ai。");
    const requestHash = digest({ days, mode, retry });
    const row = await this.repo.transaction(o, async () => {
      const existing = await this.repo.accountReports.get(o, id);
      if (existing) {
        if (existing.request_hash !== requestHash)
          throw new ApplicationError(
            409,
            "LIGHTTICK_VERSION_CONFLICT",
            "原请求编号已用于其他报告条件。",
          );
        return existing;
      }
      if (mode === "ai") {
        await this.authorizeAI();
        if (!this.queue)
          throw new ApplicationError(
            503,
            "LIGHTTICK_CAPABILITY_UNAVAILABLE",
            "报告 worker 不可用。",
          );
      }
      const original = retry
        ? await this.repo.accountReports.get(o, retry as string)
        : undefined;
      if (
        retry &&
        (!original ||
          !["failed", "cancelled", "interrupted"].includes(original.status) ||
          (original.topic ?? "account") !== this.topic ||
          !original.facts ||
          original.mode !== mode ||
          original.period_days !== days)
      )
        throw invalid("只能按原周期和类型重试已失败、取消或中断的报告。");
      const now = this.clock().toISOString();
      const facts =
        original?.facts ??
        (await (
          this.topic === "behavior" ? collectBehaviorReportFacts : this.collect
        )(this.repo, o, Number(days), this.clock()));
      if (
        mode === "ai" &&
        Buffer.byteLength(JSON.stringify(facts)) >
          ACCOUNT_REPORT_SCENE.max_input_bytes
      )
        throw new ApplicationError(
          413,
          "REQ_FIELD_INVALID",
          "统计摘要超过 AI 容量，请先生成事实报告。",
        );
      const created: AccountReportRow = {
        ...o,
        ...(this.topic === "behavior" ? { topic: this.topic } : {}),
        id,
        revision: 1,
        request_hash: requestHash,
        period_days: Number(days),
        mode: mode as "facts" | "ai",
        retry_of: retry as string | null,
        status: mode === "ai" ? "queued" : "ready",
        facts,
        output: null,
        model_selection:
          mode === "ai"
            ? (original?.model_selection ?? (await captureModel(this.repo, o)))
            : null,
        fence: null,
        lease_until: null,
        error_code: null,
        created_at: now,
        updated_at: now,
      };
      await this.repo.accountReports.save(created, 0);
      return created;
    });
    if (row.status === "queued") await this.dispatch(row).catch(() => {});
    return publicReport(row);
  }
  async dispatch(row: AccountReportRow, recovery = false) {
    if (!this.queue) return;
    await this.queue.add(
      ACCOUNT_REPORT_JOB,
      { app_id: row.appId, user_id: row.userId, report_id: row.id },
      {
        attempts: 1,
        jobId: `${row.id}-${row.revision}${recovery ? "-recovery-" + Math.floor(this.clock().getTime() / 60000) : ""}`,
      },
    );
  }
  async mutate(
    o: LightTickOwner,
    id: string,
    action: "cancel" | "delete",
    input: Record<string, unknown>,
  ) {
    if (
      Object.keys(input).some((key) => key !== "base_version") ||
      !Number.isInteger(input.base_version) ||
      Number(input.base_version) < 1
    )
      throw invalid("报告命令只接受正整数 base_version。");
    return this.repo.transaction(o, async () => {
      const row = await this.repo.accountReports.get(o, id);
      if (!row || (row.topic ?? "account") !== this.topic)
        throw reportMissing();
      if (input.base_version !== row.revision)
        throw new ApplicationError(
          409,
          "LIGHTTICK_VERSION_CONFLICT",
          "报告已变化，请刷新后重试。",
        );
      if (row.status === "deleted") return publicReport(row);
      if (action === "cancel" && !["queued", "running"].includes(row.status))
        throw invalid("报告已经结束，不能取消。");
      const next: AccountReportRow = {
        ...row,
        revision: row.revision + 1,
        status: action === "delete" ? "deleted" : "cancelled",
        fence: null,
        lease_until: null,
        error_code: null,
        output: null,
        ...(action === "delete" ? { facts: null, model_selection: null } : {}),
        updated_at: this.clock().toISOString(),
      };
      await this.repo.accountReports.save(next, row.revision);
      return publicReport(next);
    });
  }
}
