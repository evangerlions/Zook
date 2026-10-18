import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { badRequest } from "../../../shared/errors.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

const guardLevels = new Set(["relaxed", "standard", "strict"]);
const visibilityScopes = new Set(["summary", "detailed", "private"]);
const preferenceKeys = new Set(["guard_level", "visibility_scope", "mute_for_tonight", "allow_morning_summary_push", "allow_recovery_nudges"]);

/** Stores validated per-recipient sleep notification and visibility preferences. */
export class SleepPreferenceService {
  constructor(private readonly database: ApplicationDatabase) {}

  async update(userId: string, relationshipId: string, preferences: Record<string, unknown>) {
    const validated = validatePreferences(preferences);
    const [existing] = await this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID,
      kind: "guardianship_preference", ownerUserId: userId, relationshipId, limit: 1 });
    if (existing) {
      const updated = await this.database.updateFrogSleepEntity("guardianship_preference", FROGSLEEP_APP_ID,
        existing.id, { payload: { ...existing.payload, ...validated } });
      return updated?.payload ?? validated;
    }
    const now = new Date().toISOString();
    const payload = { guard_level: "standard", visibility_scope: "summary", mute_for_tonight: false,
      allow_morning_summary_push: true, allow_recovery_nudges: true, ...validated };
    await this.database.insertFrogSleepEntity({ id: randomId("sleep_pref"), appId: FROGSLEEP_APP_ID,
      kind: "guardianship_preference", ownerUserId: userId, relationshipId, payload, createdAt: now, updatedAt: now });
    return payload;
  }
}

function validatePreferences(input: Record<string, unknown>) {
  for (const [key, value] of Object.entries(input)) {
    if (!preferenceKeys.has(key)) badRequest("REQ_INVALID_BODY", `Unsupported preference field: ${key}.`);
    if (key === "guard_level") {
      if (typeof value !== "string" || !guardLevels.has(value)) badRequest("REQ_INVALID_BODY", "guard_level is invalid.");
    } else if (key === "visibility_scope") {
      if (typeof value !== "string" || !visibilityScopes.has(value)) badRequest("REQ_INVALID_BODY", "visibility_scope is invalid.");
    } else if (typeof value !== "boolean") badRequest("REQ_INVALID_BODY", `${key} must be a boolean.`);
  }
  return { ...input };
}
