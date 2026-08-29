import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import type { KVManager } from "../../infrastructure/kv/kv-manager.ts";
import type { AuthService } from "../auth/auth.service.ts";
import type { AppRegistryService } from "../app-registry/app-registry.service.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { createOpaqueToken, randomId, sha256 } from "../../shared/utils.ts";
import { LIGHTTICK_APP_ID } from "./lighttick-app.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickGuestIdentityRow } from "./lighttick.types.ts";

const GUEST_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const RATE_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT = 5;
const SCOPE = "lighttick.guest-identities";

interface RateWindow { count: number; startedAt: number }
interface IdempotencyEntry { requestHash: string; userId: string }

export interface CreateLightTickGuestIdentityCommand {
  deviceId: string;
  deviceSecret: string;
  platform: "ios" | "android";
  timezone: string;
  locale: string;
  appVersion: string;
  idempotencyKey: string;
  ipAddress: string;
  requestId?: string;
}

export class LightTickGuestIdentityService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly kv: KVManager,
    private readonly appRegistry: AppRegistryService,
    private readonly auth: AuthService,
    private readonly repository: LightTickRepository,
  ) {}

  async createOrRecover(command: CreateLightTickGuestIdentityCommand, now = new Date()) {
    await this.consumeRateLimit(command.ipAddress, now);
    const requestHash = sha256(JSON.stringify({ deviceId: command.deviceId,
      deviceSecretHash: sha256(command.deviceSecret), platform: command.platform,
      timezone: command.timezone, locale: command.locale, appVersion: command.appVersion }));
    const operationKey = `operation:${sha256(command.idempotencyKey)}`;
    const replay = await this.kv.getJson<IdempotencyEntry>(SCOPE, operationKey);
    if (replay?.requestHash !== undefined && replay.requestHash !== requestHash)
      throw new ApplicationError(409, "LIGHTTICK_IDEMPOTENCY_MISMATCH", "Idempotency key was reused with a different request.");

    let record = replay?.userId
      ? await this.repository.getGuestIdentity({ appId: LIGHTTICK_APP_ID, userId: replay.userId })
      : await this.repository.getGuestIdentityByDevice(command.deviceId);
    if (record && record.deviceSecretHash !== sha256(command.deviceSecret))
      throw new ApplicationError(401, "AUTH_TOKEN_INVALID", "Guest device proof is invalid.");
    if (record?.revokedAt || (record && new Date(record.expiresAt) <= now)) record = undefined;

    const upgradeToken = createOpaqueToken("lt_upg");
    if (!record) {
      const userId = randomId("lighttick_guest"); const timestamp = now.toISOString();
      record = { appId: LIGHTTICK_APP_ID, userId, deviceId: command.deviceId, deviceSecretHash: sha256(command.deviceSecret),
        platform: command.platform, timezone: command.timezone, locale: command.locale,
        appVersion: command.appVersion, upgradeTokenHash: sha256(upgradeToken),
        expiresAt: new Date(now.getTime() + GUEST_TTL_MS).toISOString(), createdAt: timestamp, updatedAt: timestamp };
      await this.database.insertUser({ id: userId, passwordHash: sha256(createOpaqueToken("guest_pwd")),
        passwordAlgo: "lighttick-guest", status: "ACTIVE", createdAt: timestamp });
      await this.appRegistry.ensureMembership(LIGHTTICK_APP_ID, userId, now);
      await this.recordAudit(record, "lighttick.guest.created", command.requestId);
    } else {
      record = { ...record, upgradeTokenHash: sha256(upgradeToken), updatedAt: now.toISOString() };
      await this.recordAudit(record, "lighttick.guest.recovered", command.requestId);
    }
    record = await this.repository.saveGuestIdentity(record);
    await this.kv.setJson(SCOPE, operationKey, { requestHash, userId: record.userId } satisfies IdempotencyEntry,
      Math.ceil((new Date(record.expiresAt).getTime() - now.getTime()) / 1_000));
    const session = await this.auth.issueSession(record.userId, LIGHTTICK_APP_ID, now);
    return { record, session, upgradeToken };
  }

  async getActive(userId: string, now = new Date()): Promise<LightTickGuestIdentityRow | undefined> {
    const user = await this.database.findUserById(userId);
    if (user?.passwordAlgo !== "lighttick-guest") return undefined;
    const record = await this.repository.getGuestIdentity({ appId: LIGHTTICK_APP_ID, userId });
    if (!record || record.revokedAt || new Date(record.expiresAt) <= now)
      throw new ApplicationError(410, "LIGHTTICK_GUEST_SESSION_EXPIRED", "Guest session is expired.");
    return record;
  }

  private async consumeRateLimit(ipAddress: string, now: Date) {
    const key = `rate:${sha256(ipAddress || "unknown")}`;
    const current = await this.kv.getJson<RateWindow>(SCOPE, key);
    const startedAt = current && now.getTime() - current.startedAt < RATE_WINDOW_SECONDS * 1_000
      ? current.startedAt : now.getTime();
    const count = startedAt === current?.startedAt ? current.count + 1 : 1;
    if (count > RATE_LIMIT) throw new ApplicationError(429, "RATE_LIMITED", "Guest session creation is rate limited.",
      { retryable: true, retry_after_seconds: RATE_WINDOW_SECONDS });
    await this.kv.setJson(SCOPE, key, { count, startedAt } satisfies RateWindow, RATE_WINDOW_SECONDS);
  }

  private async recordAudit(record: LightTickGuestIdentityRow, action: string, requestId?: string) {
    await this.database.insertAuditLog({ id: randomId("audit"), appId: LIGHTTICK_APP_ID,
      actorUserId: record.userId, action, resourceType: "lighttick_guest_identity",
      resourceId: record.userId, resourceOwnerUserId: record.userId,
      payload: { deviceIdHash: sha256(record.deviceId), platform: record.platform, expiresAt: record.expiresAt, requestId },
      createdAt: new Date().toISOString() });
  }
}
