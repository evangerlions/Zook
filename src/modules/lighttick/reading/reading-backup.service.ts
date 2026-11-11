import { createHash } from "node:crypto";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type {
  LightTickOwner,
  LightTickOperationRow,
} from "../lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import {
  canonical,
  digest,
  fail,
  integer,
  keys,
  object,
} from "../learning/native-learning.validation.ts";
import {
  READING_BACKUP_SECTIONS,
  type ReadingBackupManifest,
  type ReadingBackupPart,
} from "./reading-backup.types.ts";
const PART_BYTES = 256 * 1024,
  MAX_BYTES = 64 * 1024 * 1024,
  MAX_RECORDS = 100000,
  FORMAT = "lighttick-reading-ndjson-v2";
export class ReadingBackupService {
  constructor(
    readonly repo: LightTickRepository,
    readonly authorize: () => Promise<void> = async () => {},
    readonly clock = () => new Date(),
  ) {}
  private key(key: string) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key))
      fail(422, "请保留有效备份原请求编号。");
  }
  private id(id: string) {
    if (!/^readbackup-[a-f0-9]{40}$/.test(id)) fail(422, "备份编号无效。");
  }
  async list(o: LightTickOwner) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      return { items: await this.repo.readingBackups.list(o) };
    });
  }
  async read(o: LightTickOwner, id: string) {
    this.id(id);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const row = await this.repo.readingBackups.get(o, id);
      if (!row) fail(404, "未找到本人备份；已删除的备份不能恢复下载。");
      return row;
    });
  }
  async part(o: LightTickOwner, id: string, index: number) {
    this.id(id);
    integer(index, 0, 255);
    return this.repo.transaction(o, async () => {
      const manifest = await this.read(o, id);
      if (manifest.expires_at <= this.clock().toISOString())
        throw new ApplicationError(
          410,
          "LIGHTTICK_READING_BACKUP_EXPIRED",
          "备份已过期，请明确创建新快照。",
        );
      const part = await this.repo.readingBackups.part(o, id, index);
      if (!part) fail(404, "备份分片不存在；未返回不完整副本。");
      return part;
    });
  }
  async receipt(o: LightTickOwner, key: string) {
    this.key(key);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const row = await this.repo.getOperation(o, key);
      if (!row || row.entityType !== "reading_backup")
        fail(404, "未找到本人备份原回执。");
      return row.resultPayload;
    });
  }
  private async replay(o: LightTickOwner, key: string, hash: string) {
    const row = await this.repo.getOperation(o, key);
    if (!row) return;
    if (row.entityType !== "reading_backup" || row.payloadHash !== hash)
      fail(409, "原备份编号对应不同操作，请保留原请求。");
    return row.resultPayload;
  }
  private async receiptWrite(
    o: LightTickOwner,
    key: string,
    hash: string,
    action: string,
    id: string,
    body: Record<string, unknown>,
    result: Record<string, unknown>,
  ) {
    const now = this.clock().toISOString();
    await this.repo.saveOperation({
      ...o,
      operationId: key,
      deviceId: "reading-backup",
      payloadHash: hash,
      entityType: "reading_backup",
      entityId: id,
      action,
      requestPayload: body,
      resultPayload: result,
      status: "applied",
      createdAt: now,
      updatedAt: now,
    } satisfies LightTickOperationRow);
  }
  async create(
    o: LightTickOwner,
    raw: unknown,
    key: string,
  ): Promise<ReadingBackupManifest> {
    this.key(key);
    const body = structuredClone(object(raw));
    keys(body, ["format"]);
    if (body.format !== FORMAT) fail(422, "请选择完整阅读备份格式。");
    const hash = digest({ action: "create", body });
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const replay = await this.replay(o, key, hash);
      if (replay) return replay as unknown as ReadingBackupManifest;
      const now = this.clock().toISOString(),
        store = this.repo.readingBackups;
      await store.prune(o, now);
      if ((await store.list(o)).length >= 2)
        throw new ApplicationError(
          429,
          "LIGHTTICK_READING_BACKUP_CAPACITY",
          "已有两份保留快照，请先下载或删除一份。",
        );
      const id = "readbackup-" + digest([o.appId, o.userId, key]).slice(0, 40),
        expires = new Date(
          this.clock().getTime() + 24 * 60 * 60 * 1000,
        ).toISOString();
      await store.begin(o, id, expires);
      const counts = Object.fromEntries(
          READING_BACKUP_SECTIONS.map((s) => [s, 0]),
        ) as ReadingBackupManifest["counts"],
        parts: ReadingBackupManifest["parts"] = [],
        streamHash = createHash("sha256");
      let bytes = 0,
        records = 0,
        pending = Buffer.alloc(0);
      const flush = async (data: Buffer) => {
        const part: ReadingBackupPart = {
          index: parts.length,
          byte_length: data.length,
          sha256: createHash("sha256").update(data).digest("hex"),
          data_base64: data.toString("base64"),
        };
        await store.savePart(o, id, part);
        const { data_base64: _, ...meta } = part;
        parts.push(meta);
      };
      for (const section of READING_BACKUP_SECTIONS) {
        let after = "";
        const limit = ["work", "work_assets", "receipts"].includes(section)
          ? 1
          : 25;
        while (true) {
          const page = await store.entries(o, section, after, limit);
          for (const row of page) {
            if (row.section !== section || row.key <= after)
              throw Error("Reading backup ordering invariant");
            after = row.key;
            const line = Buffer.from(canonical(row) + "\n", "utf8");
            if (bytes + line.length > MAX_BYTES || records >= MAX_RECORDS)
              throw new ApplicationError(
                413,
                "LIGHTTICK_READING_BACKUP_TOO_LARGE",
                "完整备份超过64MiB或100000条；未保存截断快照。",
              );
            bytes += line.length;
            records++;
            counts[section]++;
            streamHash.update(line);
            let offset = 0;
            while (offset < line.length) {
              const take = Math.min(
                PART_BYTES - pending.length,
                line.length - offset,
              );
              pending = Buffer.concat([
                pending,
                line.subarray(offset, offset + take),
              ]);
              offset += take;
              if (pending.length === PART_BYTES) {
                await flush(pending);
                pending = Buffer.alloc(0);
              }
            }
          }
          if (page.length < limit) break;
        }
      }
      if (pending.length) await flush(pending);
      await this.authorize();
      const data = {
        id,
        revision: 1 as const,
        format: FORMAT as typeof FORMAT,
        owner: { app_id: o.appId, user_id: o.userId },
        created_at: now,
        expires_at: expires,
        byte_length: bytes,
        record_count: records,
        counts,
        parts,
        content_sha256: streamHash.digest("hex"),
      };
      const manifest = { ...data, manifest_sha256: digest(data) };
      await store.finish(o, manifest);
      await this.receiptWrite(
        o,
        key,
        hash,
        "create",
        id,
        body,
        manifest as unknown as Record<string, unknown>,
      );
      return manifest;
    });
  }
  async delete(o: LightTickOwner, id: string, raw: unknown, key: string) {
    this.key(key);
    this.id(id);
    const body = structuredClone(object(raw));
    keys(body, ["base_revision"]);
    integer(body.base_revision, 1, 1);
    const hash = digest({ action: "delete", id, body });
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const replay = await this.replay(o, key, hash);
      if (replay) return replay as { id: string; deleted: true };
      await this.read(o, id);
      await this.repo.readingBackups.delete(o, id);
      const result = { id, deleted: true as const };
      await this.receiptWrite(o, key, hash, "delete", id, body, result);
      return result;
    });
  }
}
