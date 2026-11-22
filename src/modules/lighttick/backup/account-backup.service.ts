import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { ApplicationError } from "../../../shared/errors.ts";
import { sha256 } from "../../../shared/utils.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type {
  BackupArchive,
  BackupFiles,
  BackupStore,
  Tables,
} from "./backup.types.ts";
export const backupCanonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
const fail = (status: number, message: string): never => {
  throw new ApplicationError(status, "LIGHTTICK_BACKUP_REJECTED", message);
};
function sanitize(tables: Tables) {
  const copy = structuredClone(tables);
  for (const r of copy.learning_modules ?? []) {
    r.source_config = null;
    r.storage_config = null;
    r.is_public = false;
    r.subscriber_count = 0;
  }
  for (const r of copy.content_documents ?? []) {
    r.storage = "database";
    r.commit_sha = null;
  }
  return copy;
}
function references(tables: Tables) {
  const keys = new Set<string>();
  function visit(v: any, encoded = true) {
    if (!v || typeof v !== "object") return;
    if (encoded && typeof v.$lighttick_json === "string") {
      visit(JSON.parse(v.$lighttick_json), false);
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      if (k === "storage_key" && typeof x === "string" && x) keys.add(x);
      else if (typeof x === "object") visit(x, encoded);
    }
  }
  visit(tables);
  return [...keys].sort();
}
export function backupCounts(tables: Tables) {
  const counts: Record<string, number> = {};
  for (const [t, rows] of Object.entries(tables)) {
    const group = /learning|lesson|course|content/.test(t)
      ? "学习课程与资料"
      : /investment|market|portfolio|screen|strategy|observation|backtest|research/.test(
            t,
          )
        ? "投资资料与研究"
        : /reading/.test(t)
          ? "阅读"
          : /focus/.test(t)
            ? "专注与焦点"
            : /goal|plan|task|execution/.test(t)
              ? "目标与行动"
              : /error|behavior|form/.test(t)
                ? "行为与自评"
                : "记录、复盘与偏好";
    counts[group] = (counts[group] ?? 0) + rows.length;
  }
  return counts;
}
export class AccountBackupService {
  constructor(
    private readonly repo: LightTickRepository,
    private readonly secrets: string[],
    private readonly files?: BackupFiles,
    private readonly clock = () => new Date(),
  ) {}
  private get store(): BackupStore {
    if (!this.repo.backups || !this.secrets[0])
      return fail(503, "当前后端尚未配置账户备份能力。");
    return this.repo.backups;
  }
  private async access(o: LightTickOwner, tables?: Tables) {
    const authority = await this.repo.getLearningAuthority(o);
    if (
      (authority &&
        (authority.phase !== "zook" ||
          !authority.privateEnabled ||
          !authority.readingEnabled)) ||
      (!authority && (tables?.native_lessons?.length ?? 0) > 0)
    )
      fail(403, "当前课程访问权限不足，不能通过备份读取或恢复私人内容。");
  }
  private async ready(o: LightTickOwner) {
    await this.access(o);
    if (await this.store.busy(o))
      fail(409, "有正在执行、暂停中的专注或生成任务，请结束后重新核对。");
  }
  private sign(digest: string, key = this.secrets[0]) {
    return createHmac("sha256", key)
      .update("lighttick-account-backup-v1:" + digest)
      .digest("hex");
  }
  private verify(o: LightTickOwner, input: unknown): BackupArchive {
    if (!input || Buffer.byteLength(JSON.stringify(input)) > 8 * 1024 ** 2)
      fail(413, "备份包超过8MiB或格式无效，未读取部分内容。");
    const a = input as BackupArchive;
    if (
      a.format !== "lighttick-account-v1" ||
      a.owner?.appId !== o.appId ||
      a.owner?.userId !== o.userId ||
      !Array.isArray(a.files) ||
      !a.tables ||
      typeof a.tables !== "object"
    )
      fail(403, "备份版本或所属账户不匹配。");
    const { digest, signature, ...body } = a;
    if (
      typeof digest !== "string" ||
      sha256(backupCanonical(body)) !== digest ||
      typeof signature !== "string" ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      !this.secrets.some((k) =>
        timingSafeEqual(
          Buffer.from(this.sign(digest, k)),
          Buffer.from(signature),
        ),
      )
    )
      fail(422, "备份校验失败或签名密钥已不受信任，请保留原文件。");
    if (
      a.files.some(
        (f) =>
          typeof f.content !== "string" ||
          Buffer.byteLength(f.content) > 80000 ||
          sha256(f.content) !== f.digest,
      )
    )
      fail(422, "备份文件内容不完整。");
    return a;
  }
  private async archive(o: LightTickOwner) {
    await this.ready(o);
    const { schema, tables } = await this.store.capture(o);
    await this.access(o, tables);
    for (const d of tables.content_documents ?? [])
      if (
        d.text === null ||
        d.text === undefined ||
        (d.compression !== "none" && d.compression !== null)
      )
        fail(409, "有未包含正文的外部或压缩资料，不能生成完整备份。");
    for (const d of tables.content_documents ?? [])
      if (
        sha256(d.text) !== d.hash ||
        Buffer.byteLength(d.text) !== Number(d.size)
      )
        fail(422, "资料正文与字节数或摘要不一致，未生成部分备份。");
    const clean = sanitize(tables),
      files: BackupArchive["files"] = [];
    for (const key of references(clean)) {
      if (!this.files) fail(409, "文件读取能力不可用，未生成部分备份。");
      const content = await this.files!.read(o, key);
      files.push({ storage_key: key, content, digest: sha256(content) });
    }
    const body = {
      format: "lighttick-account-v1" as const,
      id: randomUUID(),
      owner: o,
      created_at: this.clock().toISOString(),
      schema,
      tables: clean,
      files,
    };
    const digest = sha256(backupCanonical(body));
    const archive = { ...body, digest, signature: this.sign(digest) };
    if (Buffer.byteLength(JSON.stringify(archive)) > 8 * 1024 ** 2)
      fail(413, "账户内容超过8MiB备份上限，未生成部分备份。");
    return archive;
  }
  private async operation<T>(
    o: LightTickOwner,
    key: string,
    action: string,
    body: unknown,
    authorize: () => Promise<void>,
    fn: () => Promise<T>,
  ) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key))
      fail(422, "请保留有效的原请求编号。");
    return this.repo.transaction(o, async () => {
      await this.repo.lockPlanningOwner(o);
      await authorize();
      const id = "backup:" + key,
        hash = sha256(backupCanonical({ action, body })),
        old = await this.repo.getOperation(o, id);
      if (old) {
        if (old.payloadHash !== hash) fail(409, "原请求与当前输入不一致。");
        return old.resultPayload as unknown as T;
      }
      const result = await fn(),
        now = this.clock().toISOString();
      await this.repo.saveOperation({
        ...o,
        operationId: id,
        deviceId: "web",
        entityType: "account_backup",
        entityId: o.userId,
        action,
        payloadHash: hash,
        requestPayload: { action },
        resultPayload: result as any,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return result;
    });
  }
  async list(o: LightTickOwner) {
    return (await this.store.list(o)).map((e) => ({
      id: e.id,
      kind: e.kind,
      created_at: e.createdAt,
      ...e.summary,
    }));
  }
  async download(o: LightTickOwner, id: string) {
    await this.access(o);
    const e = await this.store.get(o, id);
    if (!e || e.kind === "preview") return fail(404, "备份文件不存在。");
    await this.access(o, e.data.archive.tables);
    return e.data.archive as BackupArchive;
  }
  async export(o: LightTickOwner, key: string, authorize: () => Promise<void>) {
    return this.operation(o, key, "export", {}, authorize, async () => {
      const archive = await this.archive(o),
        summary = {
          counts: backupCounts(archive.tables),
          digest: archive.digest,
          files: archive.files.length,
        };
      await this.store.put({
        ...o,
        id: archive.id,
        kind: "export",
        createdAt: archive.created_at,
        data: { archive },
        summary,
      });
      return { id: archive.id, ...summary };
    });
  }
  private async checkQuota(o: LightTickOwner) {
    const q = await this.repo.getStorageUsage(o);
    if (q.totalUsed > q.totalLimit)
      fail(
        402,
        "恢复后的学习存储超过当前套餐容量，请升级或使用较小的完整备份。",
      );
  }
  async preview(
    o: LightTickOwner,
    key: string,
    input: unknown,
    authorize: () => Promise<void>,
    authorizeNew: () => Promise<void>,
  ) {
    return this.operation(o, key, "preview", input, authorize, async () => {
      await authorizeNew();
      await this.ready(o);
      const archive = this.verify(o, input),
        current = await this.store.capture(o);
      await this.access(o, archive.tables);
      if (current.schema !== archive.schema)
        fail(409, "备份与当前数据库结构不同，需要兼容转换后再恢复。");
      if (
        references(archive.tables).sort().join() !==
        archive.files
          .map((f) => f.storage_key)
          .sort()
          .join()
      )
        fail(422, "备份文件清单不完整。");
      try {
        await this.store.dryRun(o, archive.tables, () => this.checkQuota(o));
      } catch (error) {
        if (error instanceof ApplicationError) throw error;
        fail(422, "备份未通过当前数据库约束，账户内容未改变。");
      }
      const changed =
        backupCanonical(sanitize(current.tables)) !==
        backupCanonical(archive.tables);
      const summary = {
        changed,
        source_counts: backupCounts(archive.tables),
        current_counts: backupCounts(current.tables),
        digest: archive.digest,
        expires_at: new Date(this.clock().getTime() + 86400000).toISOString(),
      };
      const id = randomUUID();
      await this.store.put({
        ...o,
        id,
        kind: "preview",
        createdAt: this.clock().toISOString(),
        data: { archive, target: sha256(backupCanonical(current)) },
        summary,
      });
      return { id, ...summary };
    });
  }
  async restore(
    o: LightTickOwner,
    key: string,
    body: { preview_id: string; mode: string; confirmed: boolean },
    authorize: () => Promise<void>,
    authorizeNew: () => Promise<void>,
  ) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key))
      fail(422, "请保留有效的原请求编号。");
    if (
      body?.mode !== "replace" ||
      body.confirmed !== true ||
      typeof body.preview_id !== "string" ||
      Object.keys(body).sort().join() !== "confirmed,mode,preview_id"
    )
      fail(422, "请先预检并明确确认以备份替换账户内容。");
    // Stage immutable source files before taking the product owner lock; this avoids reversing platform-file/account-deletion lock order.
    const prior = await this.repo.getOperation(o, "backup:" + key);
    if (prior)
      return this.operation(o, key, "restore", body, authorize, async () =>
        fail(409, "原请求已存在。"),
      );
    await authorizeNew();
    const entry = await this.store.get(o, body.preview_id);
    if (!entry || entry.kind !== "preview")
      return fail(404, "请重新上传并预检备份。");
    const archive = this.verify(o, entry.data.archive),
      mapped = structuredClone(archive.tables);
    const replacements = new Map<string, string>();
    for (const f of archive.files) {
      if (!this.files) fail(409, "文件恢复能力不可用。");
      replacements.set(
        f.storage_key,
        await this.files!.restore(o, f.storage_key, f.content),
      );
    }
    function remap(v: any) {
      if (!v || typeof v !== "object") return;
      if (typeof v.$lighttick_json === "string") {
        v.$lighttick_json = v.$lighttick_json.replace(
          /"storage_key"\s*:\s*"(?:[^"\\]|\\.)*"/g,
          (match: string) => {
            const colon = match.indexOf(":");
            const key = JSON.parse(match.slice(colon + 1));
            return replacements.has(key)
              ? match.slice(0, colon + 1) +
                  " " +
                  JSON.stringify(replacements.get(key))
              : match;
          },
        );
        return;
      }
      for (const [k, x] of Object.entries(v)) {
        if (k === "storage_key" && typeof x === "string" && replacements.has(x))
          v[k] = replacements.get(x);
        else if (typeof x === "object") remap(x);
      }
    }
    remap(mapped);
    return this.operation(o, key, "restore", body, authorize, async () => {
      await authorizeNew();
      await this.ready(o);
      if (Date.parse(String(entry.summary.expires_at)) <= +this.clock())
        fail(409, "预检已过期，请重新预检。");
      const fresh = await this.store.get(o, entry.id);
      if (!fresh) fail(409, "预检已被移除，请重新预检。");
      const current = await this.store.capture(o);
      if (sha256(backupCanonical(current)) !== entry.data.target)
        fail(409, "预检后账户内容已变化，请重新预检；本次尚未恢复。");
      const rollback = await this.archive(o);
      await this.store.put({
        ...o,
        id: rollback.id,
        kind: "rollback",
        createdAt: rollback.created_at,
        data: { archive: rollback },
        summary: {
          counts: backupCounts(rollback.tables),
          digest: rollback.digest,
          files: rollback.files.length,
        },
      });
      const version_floor = await this.store.replace(o, mapped);
      await this.checkQuota(o);
      return {
        restored: true,
        version_floor,
        preview_id: entry.id,
        rollback_id: rollback.id,
        counts: backupCounts(mapped),
      };
    });
  }
  async remove(o: LightTickOwner, id: string, authorize: () => Promise<void>) {
    return this.repo.transaction(o, async () => {
      await this.repo.lockPlanningOwner(o);
      await authorize();
      await this.store.remove(o, id);
      return { id, removed: true };
    });
  }
}
