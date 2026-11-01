import { ApplicationError } from "../../shared/errors.ts";
import type { AiNovelBillingWebhookEventRecord } from "../../shared/types.ts";
import { isObject } from "../../services/ainovel-revenuecat-client.ts";
const APP_ID = "ai_novel" as const;
const WEBHOOK_EVENT_ID_MAX_LENGTH = 256;
const MAX_TRANSFER_USER_IDS = 32;

export interface ParsedWebhookEvent {
  id: string;
  type: string;
  appId: string;
  appUserId: string;
  store: string;
  environment: "SANDBOX" | "PRODUCTION" | null;
  productId: string | null;
  providerTransactionId: string | null;
  occurredAt: string | null;
  transaction: Record<string, unknown>;
  transferredFrom: string[];
  transferredTo: string[];
}

export function readWebhookEvent(body: unknown): ParsedWebhookEvent {
  if (!isObject(body) || !boundedString(body.api_version, 64) || !isObject(body.event)) {
    throw new ApplicationError(400, "BILLING_WEBHOOK_INVALID", "RevenueCat webhook event is invalid.");
  }
  const raw = body.event;
  const id = boundedString(raw.id, WEBHOOK_EVENT_ID_MAX_LENGTH);
  const type = boundedString(raw.type, 64);
  const appId = boundedString(raw.app_id, 256);
  const isTransfer = type === "TRANSFER";
  const transferFrom = isTransfer ? boundedStringList(raw.transferred_from) : [];
  const transferTo = isTransfer ? boundedStringList(raw.transferred_to) : [];
  const appUserId = boundedString(raw.app_user_id, 256) ??
    (isTransfer ? transferTo?.[0] : undefined);
  const store = boundedString(raw.store, 64) ?? "";
  const environment = raw.environment;
  if (
    !id || !type || !appId || !appUserId ||
    (!isTransfer && (!store ||
      (environment !== "PRODUCTION" && environment !== "SANDBOX"))) ||
    (isTransfer && (
      transferFrom === undefined ||
      transferTo === undefined ||
      transferFrom.length + transferTo.length > MAX_TRANSFER_USER_IDS
    ))
  ) {
    throw new ApplicationError(400, "BILLING_WEBHOOK_INVALID", "RevenueCat webhook event is invalid.");
  }
  const occurredAt = typeof raw.event_timestamp_ms === "number" && Number.isFinite(raw.event_timestamp_ms)
    ? new Date(raw.event_timestamp_ms).toISOString()
    : null;
  return {
    id,
    type,
    appId,
    appUserId,
    store,
    environment: environment === "SANDBOX" || environment === "PRODUCTION"
      ? environment
      : null,
    productId: boundedString(raw.product_id, 128) || null,
    providerTransactionId: boundedString(raw.transaction_id, 256) || null,
    occurredAt,
    transferredFrom: transferFrom ?? [],
    transferredTo: transferTo ?? [],
    transaction: {
      type,
      product_id: raw.product_id,
      transaction_id: raw.transaction_id,
      store,
      environment,
      purchased_at_ms: raw.purchased_at_ms,
      original_purchased_at_ms: raw.original_purchased_at_ms,
      expiration_at_ms: raw.expiration_at_ms,
      cancel_reason: raw.cancel_reason,
      price_in_purchased_currency: raw.price_in_purchased_currency,
      currency: raw.currency,
      period_type: raw.period_type,
    },
  };
}

function boundedStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (value.length > MAX_TRANSFER_USER_IDS) return undefined;
  const values = value.map((item) => boundedString(item, 256));
  if (values.some((item) => item === undefined)) return undefined;
  return values as string[];
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength
    ? value.trim()
    : undefined;
}

export function toWebhookRecord(
  event: ParsedWebhookEvent,
  userId: string | null,
  status: AiNovelBillingWebhookEventRecord["status"],
  processedAt: string,
  accountDeletedAt: string | null = null,
  affectedUserIds: string[] = [],
): AiNovelBillingWebhookEventRecord {
  return {
    appId: APP_ID,
    eventId: event.id,
    eventType: event.type,
    userId,
    affectedUserIds,
    productId: event.productId,
    providerTransactionId: event.providerTransactionId,
    status,
    occurredAt: event.occurredAt,
    processedAt,
    accountDeletedAt,
  };
}
