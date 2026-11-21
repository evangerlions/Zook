import { ApplicationError } from "../../../shared/errors.ts";
import { LIGHTTICK_AI_SCENES } from "../ai/lighttick-ai-scenes.ts";
import { digest, identity, keys, object } from "../learning/native-learning.validation.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { LocalGenerationBusiness } from "./local-generation-business.ts";
import { localGenerationRules } from "./local-generation-rules.ts";
import { LOCAL_GENERATION_SCENES, type LocalGenerationRuntime, type LocalGeneration, type LocalGenerationPackage, type LocalGenerationScene } from "./local-generation.types.ts";

const leaseMs = 10 * 60_000;
const maxOutputBytes = 500_000;
const entityType = "local_generation";
const expired: GenerationError = { status: 409, code: "LIGHTTICK_GENERATION_EXPIRED", message: "生成尝试已过期，请重新开始。" };
const cancelled: GenerationError = { status: 409, code: "LIGHTTICK_GENERATION_CANCELLED", message: "生成尝试已取消。" };
const changed: GenerationError = { status: 409, code: "LIGHTTICK_GENERATION_VERSION_MISMATCH", message: "生成规则或尝试已变更，请重新准备。" };
const complete: GenerationError = { status: 409, code: "LIGHTTICK_GENERATION_FINISHED", message: "该生成已有回执，请核对结果。" };
type GenerationError = NonNullable<LocalGeneration["error"]>;

function throwFor(error: GenerationError): never {
  throw new ApplicationError(error.status, error.code, error.message);
}

export function localScene(raw: unknown): LocalGenerationScene {
  if (typeof raw !== "string" || !(LOCAL_GENERATION_SCENES as readonly string[]).includes(raw)) {
    throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "生成场景不存在。");
  }
  return raw as LocalGenerationScene;
}

export class LocalGenerationService {
  private get repository() { return this.runtime.repository; }
  private get store() { return this.repository.localGenerations; }
  private readonly business: LocalGenerationBusiness;

  constructor(private readonly runtime: LocalGenerationRuntime, private readonly authorize: () => Promise<void>,
    private readonly clock = () => new Date()) {
    this.business = new LocalGenerationBusiness(runtime, clock, async () => {
      await authorize();
      await runtime.scopePolicy.assertFull();
    });
  }

  private attemptId(owner: LightTickOwner, key: string) {
    return "localgen-" + digest([owner.appId, owner.userId, identity(key)]).slice(0, 40);
  }

  private rules(owner: LightTickOwner, name: LocalGenerationScene) {
    return localGenerationRules(this.repository, owner, name, this.runtime.resolveAiScene ?? (async name => LIGHTTICK_AI_SCENES[name]),
      this.clock().toISOString());
  }

  async contract(owner: LightTickOwner, name: LocalGenerationScene) {
    await this.authorize();
    await this.runtime.scopePolicy.assertFull();
    return (await this.rules(owner, name)).body;
  }

  async prepare(owner: LightTickOwner, key: string, body: Record<string, unknown>) {
    keys(body, ["scene", "planning_session_id", "input"]);
    const scene = localScene(body.scene);
    const input = object(body.input);
    if (Buffer.byteLength(JSON.stringify(input)) > 160_000)
      throw new ApplicationError(422, "LIGHTTICK_SCENE_INPUT_INVALID", "生成输入超出容量，请缩短资料。");
    const planning_session_id = body.planning_session_id === undefined ? undefined : identity(body.planning_session_id);
    if (planning_session_id && scene.startsWith("learning_")) {
      throw new ApplicationError(422, "LIGHTTICK_SCENE_INPUT_INVALID", "课程生成不使用规划会话。");
    }
    const id = this.attemptId(owner, key);
    const prepareHash = digest(body);
    await this.repository.transaction(owner, async () => {
      await this.authorize();
      for (const row of await this.store.pending(owner)) await this.expire(owner, row);
    });
    const result = await this.repository.transaction(owner, async () => {
      await this.authorize();
      const previous = await this.store.get(owner, id);
      if (previous?.prepareHash && previous.prepareHash !== prepareHash) this.mismatch();
      if (previous && previous.status !== "prepared") return previous;
      await this.runtime.scopePolicy.assertFull();
      const { body: rules, settings } = await this.rules(owner, scene);
      if (previous?.pending) {
        const problem = previous.rulesDigest !== rules.rules_digest ? changed : await this.abandonedBusiness(owner, previous);
        return problem ? this.end(owner, previous, problem === cancelled ? "cancelled" : "rejected", problem) : previous;
      }
      if ((await this.store.pending(owner)).length >= 2) {
        throw new ApplicationError(429, "LIGHTTICK_GENERATION_BUSY", "当前账号还有生成尝试，请先完成或取消。");
      }
      const expiresAt = new Date(this.clock().getTime() + leaseMs).toISOString();
      const work = await this.business.prepare(owner, { scene, planning_session_id, input }, settings, { id, expiresAt });
      const messages = work.prepared.request.messages.map(message => {
        if ((message.role !== "system" && message.role !== "user") || typeof message.content !== "string") {
          throw new ApplicationError(503, "LIGHTTICK_GENERATION_RULES_UNAVAILABLE", "场景消息格式暂不支持浏览器生成。");
        }
        return { role: message.role, content: message.content };
      });
      const { system_prompt: _system, scene_prompt: _prompt, ...metadata } = rules;
      const packageBody = { ...metadata, output_schema: work.prepared.schema, id, revision: 1, expires_at: expiresAt, messages };
      const generation: LocalGenerationPackage = { ...packageBody, digest: digest(packageBody) };
      const row: LocalGeneration = { ...owner, id, scene, prepareHash, rulesDigest: rules.rules_digest, expiresAt, status: "prepared",
        businessType: work.businessType, businessId: work.businessId, pending: { package: generation, snapshot: work.snapshot } };
      await this.authorize();
      await this.runtime.scopePolicy.assertFull();
      await this.store.save(row);
      return row;
    });
    if (!result.pending) return throwFor(result.error ?? complete);
    return result.pending.package;
  }

  async status(owner: LightTickOwner, id: string) {
    return this.repository.transaction(owner, async () => {
      await this.authorize();
      const row = await this.get(owner, id);
      const problem = row.status === "prepared" ? await this.abandonedBusiness(owner, row) : undefined;
      return this.data(problem ? await this.end(owner, row, problem === cancelled ? "cancelled" : "rejected", problem) : row);
    });
  }

  lookup(owner: LightTickOwner, key: string) {
    return this.status(owner, this.attemptId(owner, key));
  }

  async cancel(owner: LightTickOwner, id: string) {
    return this.repository.transaction(owner, async () => {
      await this.authorize();
      const row = await this.get(owner, id);
      return this.data(row.status === "prepared" ? await this.end(owner, row, "cancelled", cancelled) : row);
    });
  }

  async submit(owner: LightTickOwner, id: string, key: string, body: Record<string, unknown>) {
    keys(body, ["base_revision", "digest", "output", "finish_reason", "provider", "model", "usage"]);
    identity(key);
    const { base_revision, digest: packageDigest, output, finish_reason, provider, model, usage } = body;
    if (base_revision !== 1 || typeof packageDigest !== "string" || !/^[a-f0-9]{64}$/.test(packageDigest) ||
      typeof output !== "string" || !output.trim() || Buffer.byteLength(output) > maxOutputBytes ||
      !["stop", "length", "tool_calls", "error"].includes(String(finish_reason)) ||
      (model !== undefined && (typeof model !== "string" || model.length > 200)) ||
      (provider !== undefined && (typeof provider !== "string" || provider.length > 100)) ||
      (usage !== undefined && (!usage || typeof usage !== "object" || Array.isArray(usage) ||
        Buffer.byteLength(JSON.stringify(usage)) > 2048))) {
      throw new ApplicationError(422, "LIGHTTICK_SCENE_INPUT_INVALID", "生成回传格式或大小无效。");
    }
    const hash = digest(body);
    const operationId = "local-generation-result:" + digest(key);
    const finished = await this.repository.transaction(owner, async () => {
      await this.authorize();
      const row = await this.get(owner, id);
      const receipt = await this.repository.getOperation(owner, operationId);
      if (receipt) {
        if (receipt.payloadHash !== hash || receipt.entityId !== id) this.mismatch();
        return row;
      }
      if (row.status !== "prepared" || !row.pending) return row;
      if (row.pending.package.digest !== packageDigest) return { ...row, error: changed };
      await this.runtime.scopePolicy.assertFull();
      const { body: rules } = await this.rules(owner, row.scene);
      const submission = { key: operationId, hash };
      let terminal: LocalGeneration;
      const problem = row.rulesDigest !== rules.rules_digest ? changed : undefined;
      if (problem) {
        terminal = await this.end(owner, row, problem === cancelled ? "cancelled" : "rejected", problem);
      } else if (finish_reason !== "stop") {
        terminal = await this.end(owner, row, "rejected", { status: 422, code: "LIGHTTICK_SCENE_OUTPUT_INVALID", message: "模型未返回完整结果。" });
      } else {
        try {
          const resourceId = await this.business.accept(owner, row, output, String(model ?? "browser"));
          terminal = { ...row, pending: undefined, status: "succeeded", result: { ...submission, resourceId } };
          await this.store.save(terminal);
        } catch (error) {
          if (!(error instanceof ApplicationError) ||
            !["LIGHTTICK_SCENE_OUTPUT_INVALID", "LIGHTTICK_GENERATION_CONTEXT_CHANGED", "LIGHTTICK_GENERATION_CANCELLED"].includes(error.code)) throw error;
          terminal = await this.end(owner, row, error.code === cancelled.code ? "cancelled" : "rejected",
            { status: error.statusCode, code: error.code, message: error.message });
        }
      }
      const now = this.clock().toISOString();
      await this.repository.saveOperation({ ...owner, operationId, entityType, entityId: row.id,
        deviceId: "browser-generation", action: "result", payloadHash: hash, requestPayload: {}, resultPayload: {},
        status: "accepted", createdAt: now, updatedAt: now });
      return terminal;
    });
    if (finished.error) return throwFor(finished.error);
    if (finished.status !== "succeeded" || finished.result?.key !== operationId || finished.result.hash !== hash) return throwFor(complete);
    return this.data(finished);
  }

  private async get(owner: LightTickOwner, id: string) {
    const row = await this.store.get(owner, identity(id, "localgen-"));
    if (!row) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "未找到该生成尝试。");
    return this.expire(owner, row);
  }

  private async expire(owner: LightTickOwner, row: LocalGeneration) {
    return row.status === "prepared" && row.expiresAt <= this.clock().toISOString()
      ? this.end(owner, row, "expired", expired) : row;
  }

  private async abandonedBusiness(owner: LightTickOwner, row: LocalGeneration): Promise<GenerationError | undefined> {
    const snapshot = row.pending?.snapshot;
    if (!snapshot) return;
    if (snapshot.kind === "learning") {
      const status = (await this.runtime.learningWork?.store.get(owner, row.businessId))?.status;
      if (status === "cancelled") return cancelled;
      if (await this.business.currentWork(owner, row, snapshot.consentRevision)) return;
    } else if (await this.business.currentRun(owner, row)) return;
    return { status: 409, code: "LIGHTTICK_GENERATION_CONTEXT_CHANGED", message: "内容或授权已变化。本次结果无法提交。" };
  }

  private async end(owner: LightTickOwner, row: LocalGeneration, status: "cancelled" | "expired" | "rejected", error: GenerationError) {
    await this.business.stop(owner, row, status === "cancelled" ? "CANCELLED" : error.code);
    const updated: LocalGeneration = { ...row, status, error, pending: undefined };
    await this.store.save(updated);
    return updated;
  }

  private mismatch(): never {
    throw new ApplicationError(409, "LIGHTTICK_GENERATION_IDEMPOTENCY_MISMATCH", "同一幂等键已用于另一份请求。");
  }

  private data(row: LocalGeneration) {
    return { id: row.id, scene: row.scene, status: row.status, expires_at: row.expiresAt,
      business_type: row.businessType, business_id: row.businessId, resource_id: row.result?.resourceId ?? null,
      error_code: row.error?.code ?? null };
  }
}
