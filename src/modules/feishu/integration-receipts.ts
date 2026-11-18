import { createHash } from "node:crypto";
import type { KVManager } from "../../infrastructure/kv/kv-manager.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { FeishuApiError } from "./feishu-client.ts";

export interface IntegrationReceipt {
  status: "processing" | "accepted" | "failed" | "unknown";
  operationId: string;
  createdAt: string;
  result?: { messageId?: string; recordId?: string };
  error?: { code: string; message: string };
}
interface StoredReceipt extends IntegrationReceipt { bodyHash: string; }

/** No expiration: a timed-out mutation must never turn into a second write after a TTL. */
export class IntegrationReceipts {
  constructor(private readonly kv: KVManager) {}

  async execute(caller: string, operation: string, key: string | undefined, input: unknown,
    write: (operationId: string) => Promise<NonNullable<IntegrationReceipt["result"]>>): Promise<IntegrationReceipt> {
    if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Idempotency-Key must contain 8–128 safe characters.");
    }
    const operationId = createHash("sha256").update(JSON.stringify([caller, operation, key])).digest("hex");
    const bodyHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const pending: StoredReceipt = { operationId, bodyHash, status: "processing", createdAt: new Date().toISOString() };
    const claimed = await this.kv.setStringIfAbsent("feishu-receipts", operationId, JSON.stringify(pending));
    if (!claimed) {
      const previous = await this.kv.getJson<StoredReceipt>("feishu-receipts", operationId);
      if (!previous || previous.bodyHash !== bodyHash) throw new ApplicationError(409, "INTEGRATION_IDEMPOTENCY_CONFLICT", "Idempotency key was already used with different input.");
      return this.publicReceipt(previous);
    }
    let receipt = pending;
    try {
      receipt = { ...pending, status: "accepted", result: await write(operationId) };
    } catch (error) {
      const definite = error instanceof ApplicationError || error instanceof FeishuApiError && error.definite;
      receipt = { ...pending, status: definite ? "failed" : "unknown", error: {
        code: error instanceof ApplicationError ? error.code : "FEISHU_UNAVAILABLE",
        message: error instanceof ApplicationError || error instanceof FeishuApiError ? error.message : "External operation outcome is unknown. Investigate before retrying.",
      } };
    }
    await this.kv.setJson("feishu-receipts", operationId, receipt);
    return this.publicReceipt(receipt);
  }

  private publicReceipt({ bodyHash: _, ...receipt }: StoredReceipt): IntegrationReceipt { return receipt; }
}
