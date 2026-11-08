import { InvestmentService } from "../investments/investment.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { GitHubState, GitHubTest } from "./github.types.ts";
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
import { githubFields, GitHubClient } from "./github.client.ts";
export const GITHUB_TEST_JOB = "lighttick.github.test";
export const emptyGitHub = (): GitHubState => ({
  mode: "default",
  revision: 0,
  repository: null,
  branch: null,
  secret: null,
  updated_at: null,
});
export const githubSummary = (s: GitHubState) => ({
  revision: s.revision,
  mode: s.mode,
  repository: s.repository,
  branch: s.branch,
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
}: GitHubTest) => ({
  id,
  revision,
  settings_revision,
  target,
  status,
  error_code,
  created_at,
  updated_at,
});
export class GitHubService extends InvestmentService {
  constructor(
    repo: LightTickRepository,
    readonly crypto: AesGcmPayloadCryptoService,
    readonly keyId: () => Promise<string>,
    readonly queue: JobQueue,
    readonly connection = new GitHubClient(),
    authorize: () => Promise<void> = async () => {},
    clock = () => new Date(),
  ) {
    super(repo, authorize, clock);
  }
  async summary(o: LightTickOwner) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      return githubSummary((await this.repo.github.get(o)) ?? emptyGitHub());
    });
  }
  async receipt(o: LightTickOwner, key: string) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const op = await this.repo.getOperation(o, key);
      if (
        !op ||
        op.entityType !== "github_settings" ||
        op.entityId !== "settings"
      )
        fail(404, "未找到该GitHub 设置回执。");
      return op.resultPayload as ReturnType<typeof githubSummary>;
    });
  }
  async configure(o: LightTickOwner, b: Record<string, unknown>, key: string) {
    keys(b, ["base_revision", "mode", "repository", "branch", "token"]);
    const base = integer(b.base_revision, 0, 2147483646);
    if (
      !["default", "custom"].includes(b.mode as string) ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(key)
    )
      fail(422, "请选择GitHub模式并保留原请求标识。");
    const personal = b.mode === "custom";
    const fields = personal
      ? githubFields(b)
      : { repository: null, branch: null, token: null };
    const { repository, branch } = fields;
    if (
      !personal &&
      (b.repository !== null || b.branch !== null || b.token !== null)
    )
      fail(422, "Default mode requires null repository, branch and token.");
    const hash = digest({ o, action: "github-settings", b });
    const prior = await this.repo.transaction(o, async () => {
      await this.authorize();
      const op = await this.repo.getOperation(o, key);
      if (!op) return undefined;
      if (
        op.entityType !== "github_settings" ||
        op.entityId !== "settings" ||
        op.payloadHash !== hash
      )
        fail(409, "原请求标识已用于另一份设置。");
      return op.resultPayload as ReturnType<typeof githubSummary>;
    });
    if (prior) return prior;
    // Resolve secrets and check remote access outside owner locks. Replays never call GitHub.
    let token = fields.token;
    if (personal && token === null)
      token = (await this.credentials(o, { mode: "custom", revision: base }))
        .token;
    if (personal) {
      try {
        await this.connection.check({
          repository: repository!,
          branch: branch!,
          token: token!,
        });
      } catch {
        fail(
          422,
          "GitHub repository/branch could not be read; settings were not saved.",
        );
      }
    }
    const secret = personal
      ? await this.crypto.encryptJsonEnvelope(
          Buffer.from(
            JSON.stringify({
              owner: o,
              revision: base + 1,
              repository,
              branch,
              token,
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
          oldReceipt.entityType !== "github_settings" ||
          oldReceipt.entityId !== "settings" ||
          oldReceipt.payloadHash !== hash
        )
          fail(409, "原请求标识已用于另一份设置，请勿自动覆盖。");
        return oldReceipt.resultPayload as ReturnType<typeof githubSummary>;
      }
      const old = (await this.repo.github.get(o)) ?? emptyGitHub();
      if (old.revision !== base)
        fail(409, "GitHub 设置已变化，请比较本机输入与云端修订。");
      const now = this.clock().toISOString(),
        row: GitHubState = {
          revision: base + 1,
          mode: personal ? "custom" : "default",
          repository,
          branch,
          secret,
          updated_at: now,
        };
      await this.repo.github.save(o, row, base);
      const result = githubSummary(row);
      await this.repo.saveOperation({
        ...o,
        operationId: key,
        deviceId: "github-http",
        payloadHash: hash,
        entityType: "github_settings",
        entityId: "settings",
        action: "configure",
        requestPayload: {
          base_revision: base,
          mode: row.mode,
          repository,
          branch,
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
  async credentials(
    o: LightTickOwner,
    selection: { mode: "custom"; revision: number },
  ) {
    const row = await this.repo.transaction(o, async () => {
      await this.authorize();
      const s = await this.repo.github.get(o);
      if (
        !s ||
        s.mode !== "custom" ||
        s.revision !== selection.revision ||
        !s.secret
      )
        fail(409, "所选GitHub修订已变化，请重新核对并发起任务。");
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
        value.repository !== row.repository ||
        value.branch !== row.branch ||
        typeof value.token !== "string"
      )
        throw Error();
      return {
        repository: row.repository!,
        branch: row.branch!,
        token: value.token as string,
      };
    } catch {
      fail(503, "GitHub密钥暂不可用，请重新配置；不会改用其他GitHub。");
    }
  }
  async assertCurrent(
    o: LightTickOwner,
    s: { mode: "custom"; revision: number },
  ) {
    await this.repo.transaction(o, async () => {
      await this.authorize();
      const row = await this.repo.github.get(o);
      if (
        s.mode === "custom" &&
        (row?.revision !== s.revision || row.mode !== "custom")
      )
        fail(409, "GitHub已变化，本次结果未采用。");
    });
  }
  async testReceipt(o: LightTickOwner, key: string) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const op = await this.repo.getOperation(o, key);
      if (!op || op.entityType !== "github_test" || op.action !== "test")
        fail(404, "未找到该连接测试回执。");
      return this.readTest(o, op.entityId);
    });
  }
  async testCredentials(row: GitHubTest) {
    await this.assertRevision(row, row.settings_revision);
    if (row.target === "saved")
      return this.credentials(row, {
        mode: "custom",
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
        repository: string;
        branch: string;
        token: string;
      };
    } catch {
      fail(503, "临时 GitHub密钥暂不可用。");
    }
  }
  async assertRevision(o: LightTickOwner, revision: number) {
    await this.repo.transaction(o, async () => {
      await this.authorize();
      if (
        (await this.repo.github.get(o))?.revision !== revision &&
        !(revision === 0 && !(await this.repo.github.get(o)))
      )
        fail(409, "设置已变化，本次测试结果未采用。");
    });
  }
  async createTest(o: LightTickOwner, b: Record<string, unknown>, key: string) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) fail(422, "保留有效原请求标识。");
    keys(b, ["settings_revision", "config"]);
    const revision = integer(b.settings_revision, 0, 2147483647),
      id = "githubtest-" + digest([o, key]).slice(0, 40),
      target = b.config === undefined ? "saved" : "draft";
    let encrypted = null,
      config: Record<string, string> | undefined;
    if (target === "draft") {
      const value = object(b.config);
      keys(value, ["repository", "branch", "token"]);
      const fields = githubFields(value);
      config = fields as Record<string, string>;
    }
    const replay = await this.repo.transaction(o, async () => {
      await this.authorize();
      const r = await this.repo.getOperation(o, key);
      if (!r) return false;
      if (
        r.entityType !== "github_test" ||
        r.entityId !== id ||
        r.action !== "test" ||
        r.payloadHash !==
          digest({ entity: "github_test", id, action: "test", b })
      )
        fail(409, "测试原请求身份不匹配。");
      return true;
    });
    if (replay) return this.readTest(o, id);
    if (config && config.token === null)
      config.token = (
        await this.credentials(o, { mode: "custom", revision })
      ).token;
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
      "github_test",
      id,
      "test",
      b,
      async (now) => {
        const s = await this.repo.github.get(o);
        if (
          (s?.revision ?? 0) !== revision ||
          (target === "saved" && (s?.mode !== "custom" || !s.secret))
        )
          fail(409, "请核对当前GitHub 设置修订。");
        const recent = await this.repo.github.recent(
          o,
          now.slice(0, 10) + "T00:00:00.000Z",
        );
        if (recent.length >= 24 || (await this.repo.github.active(o)))
          fail(429, "连接测试已有任务或今日预算已用完。");
        const row: GitHubTest = {
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
        await this.repo.github.saveTest(row, 0);
        return testSummary(row);
      },
      {
        settings_revision: revision,
        target,
        ...(config
          ? {
              repository: config.repository,
              branch: config.branch,
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
      const r = await this.repo.github.test(o, id);
      if (!r) fail(404, "GitHub 测试不存在。");
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
    return this.command(o, key, "github_test", id, "cancel", b, async (now) => {
      const r = await this.repo.github.test(o, id);
      if (!r) fail(404, "GitHub 测试不存在。");
      if (r.revision !== revision || !["queued", "running"].includes(r.status))
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
      await this.repo.github.saveTest(next, revision);
      return testSummary(next);
    });
  }
  async dispatch(o: LightTickOwner, id: string) {
    const r = await this.repo.github.test(o, id);
    if (!r || !["queued", "running"].includes(r.status)) return;
    try {
      await this.queue.add(
        GITHUB_TEST_JOB,
        { app_id: o.appId, user_id: o.userId, work_id: id },
        {
          jobId: "githubtest-" + digest([o, id, r.attempt]).slice(0, 40),
          attempts: 1,
        },
      );
    } catch {
      /* Persisted queued work is recovered by the existing worker. */
    }
  }
}
