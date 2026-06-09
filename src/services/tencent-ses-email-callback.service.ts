import { timingSafeEqual } from "node:crypto";
import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { badRequest, unauthorized } from "../shared/errors.ts";
import type {
  AdminAppSummary,
  AdminEmailDeliveryEventItem,
  AdminEmailDeliveryEventListDocument,
  EmailDeliveryEventRecord,
  TencentSesEmailCallbackAcceptedDocument,
  TencentSesEmailEvent,
} from "../shared/types.ts";
import { randomId } from "../shared/utils.ts";
import type { CommonPasswordConfigService } from "./common-password-config.service.ts";

export const TENCENT_SES_CALLBACK_TOKEN_PASSWORD_KEY = "tencent.ses_callback_token";

const TENCENT_SES_EMAIL_EVENTS = [
  "delivered",
  "dropped",
  "bounce",
  "open",
  "click",
  "spamreport",
  "unsubscribe",
  "deferred",
] as const satisfies readonly TencentSesEmailEvent[];

const TENCENT_SES_EMAIL_EVENT_SET = new Set<string>(TENCENT_SES_EMAIL_EVENTS);
const TENCENT_SES_EMAIL_EVENT_ID_MAP = new Map<number, TencentSesEmailEvent>([
  [1, "delivered"],
  [2, "dropped"],
  [3, "bounce"],
  [4, "open"],
  [5, "click"],
  [6, "spamreport"],
  [7, "unsubscribe"],
  [8, "deferred"],
]);

export class TencentSesEmailCallbackService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly commonPasswordConfigService: CommonPasswordConfigService,
  ) {}

  async receiveCallback(
    body: unknown,
    options: {
      callbackToken?: string;
      receivedAt?: Date;
    } = {},
  ): Promise<TencentSesEmailCallbackAcceptedDocument> {
    await this.assertCallbackToken(options.callbackToken);
    const payload = this.asObject(body);
    const event = this.requireEvent(payload);
    const email = this.requireString(payload, "email").toLowerCase();
    const timestamp = this.requireInteger(payload, "timestamp");
    const eventId = this.optionalInteger(payload, "eventid");
    this.assertEventIdMatchesEvent(event, eventId);
    const receivedAtIso = (options.receivedAt ?? new Date()).toISOString();
    const record: EmailDeliveryEventRecord = {
      id: randomId("email_event"),
      provider: "tencent_ses",
      event,
      eventId,
      email,
      link: this.optionalString(payload, "link"),
      bulkId: this.optionalString(payload, "bulkId"),
      timestamp,
      reason: this.optionalString(payload, "reason"),
      bounceType: this.optionalString(payload, "bounceType"),
      username: this.optionalString(payload, "username"),
      from: this.optionalString(payload, "from"),
      fromDomain: this.optionalString(payload, "fromDomain"),
      templateId: this.optionalNumber(payload, "templateId"),
      subject: this.optionalString(payload, "subject"),
      messageId: this.optionalString(payload, "messageId"),
      userAgent: this.optionalString(payload, "useragent"),
      sentTimestamp: this.optionalNumber(payload, "sentTimestamp"),
      rawPayload: payload,
      occurredAt: this.timestampToIso(timestamp) ?? receivedAtIso,
      receivedAt: receivedAtIso,
    };
    await this.database.insertEmailDeliveryEvent(record);
    return {
      accepted: true,
      id: record.id,
      event,
    };
  }

  async listForAdmin(
    app: AdminAppSummary,
    filter: {
      event?: string;
      email?: string;
      limit?: number;
    } = {},
  ): Promise<AdminEmailDeliveryEventListDocument> {
    const event = filter.event?.trim()
      ? this.parseEvent(filter.event)
      : undefined;
    const records = await this.database.listEmailDeliveryEvents({
      event,
      email: filter.email,
      limit: this.normalizeLimit(filter.limit),
    });
    return {
      app,
      items: records.map((record) => this.toAdminItem(record)),
    };
  }

  private toAdminItem(record: EmailDeliveryEventRecord): AdminEmailDeliveryEventItem {
    return {
      id: record.id,
      provider: record.provider,
      event: record.event,
      eventId: record.eventId,
      email: record.email,
      link: record.link,
      bulkId: record.bulkId,
      timestamp: record.timestamp,
      reason: record.reason,
      bounceType: record.bounceType,
      username: record.username,
      from: record.from,
      fromDomain: record.fromDomain,
      templateId: record.templateId,
      subject: record.subject,
      messageId: record.messageId,
      userAgent: record.userAgent,
      sentTimestamp: record.sentTimestamp,
      occurredAt: record.occurredAt,
      receivedAt: record.receivedAt,
    };
  }

  private asObject(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      badRequest("REQ_INVALID_BODY", "Tencent SES callback body must be a JSON object.");
    }
    return body as Record<string, unknown>;
  }

  private async assertCallbackToken(receivedToken?: string): Promise<void> {
    const configuredToken = await this.commonPasswordConfigService.getValue(
      TENCENT_SES_CALLBACK_TOKEN_PASSWORD_KEY,
    );
    if (!configuredToken) {
      unauthorized("AUTH_INVALID_TOKEN", "Tencent SES callback token is not configured.");
    }

    if (!receivedToken || !this.safeEqual(receivedToken, configuredToken)) {
      unauthorized("AUTH_INVALID_TOKEN", "Tencent SES callback token is invalid.");
    }
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, "utf8");
    const rightBuffer = Buffer.from(right, "utf8");
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private requireEvent(payload: Record<string, unknown>): TencentSesEmailEvent {
    return this.parseEvent(this.requireString(payload, "event"));
  }

  private parseEvent(value: string): TencentSesEmailEvent {
    const normalized = value.trim();
    if (!TENCENT_SES_EMAIL_EVENT_SET.has(normalized)) {
      badRequest("REQ_INVALID_BODY", `Unsupported Tencent SES email event: ${normalized || "<empty>"}.`);
    }
    return normalized as TencentSesEmailEvent;
  }

  private requireString(payload: Record<string, unknown>, key: string): string {
    const value = this.optionalString(payload, key);
    if (!value) {
      badRequest("REQ_INVALID_BODY", `Tencent SES callback field ${key} is required.`);
    }
    return value;
  }

  private optionalString(payload: Record<string, unknown>, key: string): string | undefined {
    const value = payload[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private optionalNumber(payload: Record<string, unknown>, key: string): number | undefined {
    const value = payload[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  private requireNumber(payload: Record<string, unknown>, key: string): number {
    const value = this.optionalNumber(payload, key);
    if (value === undefined) {
      badRequest("REQ_INVALID_BODY", `Tencent SES callback field ${key} must be a valid number.`);
    }
    return value;
  }

  private requireInteger(payload: Record<string, unknown>, key: string): number {
    const value = this.requireNumber(payload, key);
    if (!Number.isInteger(value)) {
      badRequest("REQ_INVALID_BODY", `Tencent SES callback field ${key} must be an integer.`);
    }
    return value;
  }

  private optionalInteger(payload: Record<string, unknown>, key: string): number | undefined {
    const rawValue = payload[key];
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      return undefined;
    }
    const value = this.requireNumber(payload, key);
    if (!Number.isInteger(value)) {
      badRequest("REQ_INVALID_BODY", `Tencent SES callback field ${key} must be an integer.`);
    }
    return value;
  }

  private assertEventIdMatchesEvent(event: TencentSesEmailEvent, eventId?: number): void {
    if (eventId === undefined) {
      return;
    }
    const mappedEvent = TENCENT_SES_EMAIL_EVENT_ID_MAP.get(eventId);
    if (mappedEvent !== event) {
      badRequest("REQ_INVALID_BODY", `Tencent SES callback eventid ${eventId} does not match event ${event}.`);
    }
  }

  private normalizeLimit(limit?: number): number {
    if (!Number.isFinite(limit)) {
      return 100;
    }
    return Math.max(1, Math.min(Math.floor(limit as number), 500));
  }

  private timestampToIso(timestamp?: number): string | undefined {
    if (timestamp === undefined) {
      return undefined;
    }
    const millis = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
}
