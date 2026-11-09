import { InvestmentService } from "../investments/investment.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type {
  ModelSelection,
  PersonalModelState,
  ModelTest,
} from "./personal-model.types.ts";
import type { AesGcmPayloadCryptoService } from "../../../services/aes-gcm-payload-crypto.service.ts";
import type { JobQueue } from "../../../infrastructure/queue/job-queue.ts";
import {
  object,
  keys,
  text,
  integer,
  digest,
  fail,
} from "../learning/native-learning.validation.ts";
import { publicSourceAddress } from "../learning/learning-sources.ts";
import { isIP } from "node:net";
export const MODEL_TEST_JOB = "lighttick.personal-model.test";
export const emptyModel = (): PersonalModelState => ({
  mode: "platform",
  revision: 0,
  base_url: null,
  model_name: null,
  secret: null,
  updated_at: null,
});
export const modelSummary = (s: PersonalModelState) => ({
  revision: s.revision,
  mode: s.mode,
  base_url: s.base_url,
  model_name: s.model_name,
  configured: !!s.secret,
  updated_at: s.updated_at,
  storage: "account_encrypted" as const,
});
export const testSummary = ({
  id,
  revision,
  settings_revision,
  target,
  status,
  error_code,
  created_at,
  updated_at,
}: ModelTest) => ({
  id,
  revision,
  settings_revision,
  target,
  status,
  error_code,
  created_at,
  updated_at,
});
export async function captureModel(
  repo: LightTickRepository,
  o: LightTickOwner,
): Promise<ModelSelection> {
  const s = await repo.personalModels.get(o);
  return { mode: s?.mode ?? "platform", revision: s?.revision ?? 0 };
}
export function modelUrl(raw: unknown) {
  const value = text(raw, 2048, true);
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    fail(422, "模型地址无效。");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    (u.port && u.port !== "443") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (isIP(host) && !publicSourceAddress(host))
  )
    fail(422, "请使用公网 HTTPS 模型地址；服务端 localhost 不是你的电脑。");
  return u
    .toString()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "");
}
export class PersonalModelService extends InvestmentService {
  constructor(
    repo: LightTickRepository,
    readonly crypto: AesGcmPayloadCryptoService,
    readonly keyId: () => Promise<string>,
    readonly queue: JobQueue,
    authorize: () => Promise<void> = async () => {},
    clock = () => new Date(),
  ) {
    super(repo, authorize, clock);
  }
  async summary(o: LightTickOwner) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      return modelSummary(
        (await this.repo.personalModels.get(o)) ?? emptyModel(),
      );
    });
  }
  async receipt(o: LightTickOwner, key: string) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const op = await this.repo.getOperation(o, key);
      if (
        !op ||
        op.entityType !== "personal_model_settings" ||
        op.entityId !== "settings"
      )
        fail(404, "未找到该模型设置回执。");
      return op.resultPayload as ReturnType<typeof modelSummary>;
    });
  }
  async configure(o: LightTickOwner, b: Record<string, unknown>, key: string) {
    keys(b, ["base_revision", "mode", "base_url", "model_name", "api_key"]);
    const base = integer(b.base_revision, 0, 2147483646);
    if (
      !["platform", "personal"].includes(b.mode as string) ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(key)
    )
      fail(422, "请选择模型模式并保留原请求标识。");
    const personal = b.mode === "personal",
      base_url = personal ? modelUrl(b.base_url) : null,
      model_name = personal ? text(b.model_name, 100, true) : null;
    let api_key: string | null = null;
    if (personal) {
      api_key = text(b.api_key, 4096, true);
      if (/[\x00-\x20\x7f]/.test(api_key!)) fail(422, "密钥包含无效字符。");
    } else if (
      b.base_url !== null ||
      b.model_name !== null ||
      b.api_key !== null
    )
      fail(422, "清除个人配置时各字段必须为 null。");
    if (model_name && /[\x00-\x1f\x7f]/.test(model_name))
      fail(422, "模型名称包含控制字符。");
    const hash = digest({ o, action: "model-settings", b });
    const prior = await this.repo.transaction(o, async () => {
      await this.authorize();
      const op = await this.repo.getOperation(o, key);
      if (!op) return undefined;
      if (
        op.entityType !== "personal_model_settings" ||
        op.entityId !== "settings" ||
        op.payloadHash !== hash
      )
        fail(409, "原请求标识已用于另一份设置。");
      return op.resultPayload as ReturnType<typeof modelSummary>;
    });
    if (prior) return prior;
    // Crypto/key resolution and any external work stay outside the owner transaction.
    const secret = personal
      ? await this.crypto.encryptJsonEnvelope(
          Buffer.from(
            JSON.stringify({
              owner: o,
              revision: base + 1,
              base_url,
              model_name,
              api_key,
            }),
          ),
          await this.keyId(),
        )
      : null;
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const oldReceipt = await this.repo.getOperation(o, key);
      if (oldReceipt) {
        if (
          oldReceipt.entityType !== "personal_model_settings" ||
          oldReceipt.entityId !== "settings" ||
          oldReceipt.payloadHash !== hash
        )
          fail(409, "原请求标识已用于另一份设置，请勿自动覆盖。");
        return oldReceipt.resultPayload as ReturnType<typeof modelSummary>;
      }
      const old = (await this.repo.personalModels.get(o)) ?? emptyModel();
      if (old.revision !== base)
        fail(409, "模型设置已变化，请比较本机输入与云端修订。");
      const now = this.clock().toISOString(),
        row: PersonalModelState = {
          revision: base + 1,
          mode: personal ? "personal" : "platform",
          base_url,
          model_name,
          secret,
          updated_at: now,
        };
      await this.repo.personalModels.save(o, row, base);
      const result = modelSummary(row);
      await this.repo.saveOperation({
        ...o,
        operationId: key,
        deviceId: "personal-model-http",
        payloadHash: hash,
        entityType: "personal_model_settings",
        entityId: "settings",
        action: "configure",
        requestPayload: {
          base_revision: base,
          mode: row.mode,
          base_url,
          model_name,
          secret_omitted: true,
        },
        resultPayload: result,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return result;
    });
  }
  async credentials(o: LightTickOwner, selection: ModelSelection) {
    const row = await this.repo.transaction(o, async () => {
      await this.authorize();
      const s = await this.repo.personalModels.get(o);
      if (
        !s ||
        s.mode !== "personal" ||
        s.revision !== selection.revision ||
        !s.secret
      )
        fail(409, "所选个人模型修订已变化，请重新核对并发起任务。");
      return s;
    });
    try {
      const value = JSON.parse(
        (
          await this.crypto.decryptJsonEnvelope(row.secret as any)
        ).plaintext.toString(),
      );
      if (
        digest(value.owner) !== digest({ appId: o.appId, userId: o.userId }) ||
        value.revision !== selection.revision ||
        value.base_url !== row.base_url ||
        value.model_name !== row.model_name ||
        typeof value.api_key !== "string"
      )
        throw Error();
      return {
        base_url: row.base_url!,
        model_name: row.model_name!,
        api_key: value.api_key as string,
      };
    } catch {
      fail(503, "个人模型密钥暂不可用，请重新配置；不会改用其他模型。");
    }
  }
  async assertCurrent(o: LightTickOwner, s: ModelSelection) {
    await this.repo.transaction(o, async () => {
      await this.authorize();
      const row = await this.repo.personalModels.get(o);
      if (
        s.mode === "personal" &&
        (row?.revision !== s.revision || row.mode !== "personal")
      )
        fail(409, "个人模型已变化，本次结果未采用。");
    });
  }
  async testReceipt(o: LightTickOwner, key: string) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const op = await this.repo.getOperation(o, key);
      if (
        !op ||
        op.entityType !== "personal_model_test" ||
        op.action !== "test"
      )
        fail(404, "未找到该连接测试回执。");
      return this.readTest(o, op.entityId);
    });
  }
  async testCredentials(row: ModelTest) {
    await this.assertRevision(row, row.settings_revision);
    if (row.target === "saved")
      return this.credentials(row, {
        mode: "personal",
        revision: row.settings_revision,
      });
    if (!row.draft_secret) fail(409, "临时测试密钥已清除。");
    try {
      const value = JSON.parse(
        (
          await this.crypto.decryptJsonEnvelope(row.draft_secret as any)
        ).plaintext.toString(),
      );
      if (
        digest(value.owner) !==
          digest({ appId: row.appId, userId: row.userId }) ||
        value.test_id !== row.id ||
        value.revision !== row.settings_revision
      )
        throw Error();
      return value.config as {
        base_url: string;
        model_name: string;
        api_key: string;
      };
    } catch {
      fail(503, "临时模型密钥暂不可用。");
    }
  }
  async assertRevision(o: LightTickOwner, revision: number) {
    await this.repo.transaction(o, async () => {
      await this.authorize();
      if (
        (await this.repo.personalModels.get(o))?.revision !== revision &&
        !(revision === 0 && !(await this.repo.personalModels.get(o)))
      )
        fail(409, "设置已变化，本次测试结果未采用。");
    });
  }
  async createTest(o: LightTickOwner, b: Record<string, unknown>, key: string) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) fail(422, "保留有效原请求标识。");
    keys(b, ["settings_revision", "config"]);
    const revision = integer(b.settings_revision, 0, 2147483647),
      id = "modeltest-" + digest([o, key]).slice(0, 40),
      target = b.config === undefined ? "saved" : "draft";
    let encrypted = null,
      config: Record<string, string> | undefined;
    if (target === "draft") {
      const value = object(b.config);
      keys(value, ["base_url", "model_name", "api_key"]);
      const api_key = text(value.api_key, 4096, true),
        model_name = text(value.model_name, 100, true);
      if (/[\x00-\x20\x7f]/.test(api_key) || /[\x00-\x1f\x7f]/.test(model_name))
        fail(422, "临时模型配置包含无效字符。");
      config = { base_url: modelUrl(value.base_url), model_name, api_key };
    }
    const replay = await this.repo.transaction(o, async () => {
      await this.authorize();
      const r = await this.repo.getOperation(o, key);
      if (!r) return false;
      if (
        r.entityType !== "personal_model_test" ||
        r.entityId !== id ||
        r.action !== "test" ||
        r.payloadHash !==
          digest({ entity: "personal_model_test", id, action: "test", b })
      )
        fail(409, "测试原请求身份不匹配。");
      return true;
    });
    if (replay) return this.readTest(o, id);
    if (config)
      encrypted = await this.crypto.encryptJsonEnvelope(
        Buffer.from(
          JSON.stringify({ owner: o, revision, test_id: id, config }),
        ),
        await this.keyId(),
      );
    await this.command(
      o,
      key,
      "personal_model_test",
      id,
      "test",
      b,
      async (now) => {
        const s = await this.repo.personalModels.get(o);
        if (
          (s?.revision ?? 0) !== revision ||
          (target === "saved" && (s?.mode !== "personal" || !s.secret))
        )
          fail(409, "请核对当前模型设置修订。");
        const recent = await this.repo.personalModels.recent(
          o,
          now.slice(0, 10) + "T00:00:00.000Z",
        );
        if (recent.length >= 24 || (await this.repo.personalModels.active(o)))
          fail(429, "连接测试已有任务或今日预算已用完。");
        const row: ModelTest = {
          ...o,
          id,
          revision: 1,
          settings_revision: revision,
          target,
          draft_secret: encrypted,
          status: "queued",
          request_key: key,
          attempt: 0,
          fence: null,
          lease_until: null,
          error_code: null,
          created_at: now,
          updated_at: now,
        };
        await this.repo.personalModels.saveTest(row, 0);
        return testSummary(row);
      },
      {
        settings_revision: revision,
        target,
        ...(config
          ? {
              base_url: config.base_url,
              model_name: config.model_name,
              secret_omitted: true,
            }
          : {}),
      },
    );
    await this.dispatch(o, id);
    return this.readTest(o, id);
  }
  async readTest(o: LightTickOwner, id: string) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const r = await this.repo.personalModels.test(o, id);
      if (!r) fail(404, "模型测试不存在。");
      return testSummary(r);
    });
  }
  async cancelTest(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) fail(422, "保留有效原请求标识。");
    keys(b, ["base_revision"]);
    const revision = integer(b.base_revision, 1, 2147483646);
    return this.command(
      o,
      key,
      "personal_model_test",
      id,
      "cancel",
      b,
      async (now) => {
        const r = await this.repo.personalModels.test(o, id);
        if (!r) fail(404, "模型测试不存在。");
        if (
          r.revision !== revision ||
          !["queued", "running"].includes(r.status)
        )
          fail(409, "测试回执已变化，请先刷新核对。");
        const next = {
          ...r,
          revision: revision + 1,
          status: "cancelled" as const,
          draft_secret: null,
          fence: null,
          lease_until: null,
          updated_at: now,
        };
        await this.repo.personalModels.saveTest(next, revision);
        return testSummary(next);
      },
    );
  }
  async dispatch(o: LightTickOwner, id: string) {
    const r = await this.repo.personalModels.test(o, id);
    if (!r || !["queued", "running"].includes(r.status)) return;
    try {
      await this.queue.add(
        MODEL_TEST_JOB,
        { app_id: o.appId, user_id: o.userId, work_id: id },
        {
          jobId: "modeltest-" + digest([o, id, r.attempt]).slice(0, 40),
          attempts: 1,
        },
      );
    } catch {
      /* Persisted queued work is recovered by the existing worker. */
    }
  }
}
