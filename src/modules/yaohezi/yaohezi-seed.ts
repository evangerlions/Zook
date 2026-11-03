import type { DatabaseSeed } from "../../shared/types.ts";

export const YAOHEZI_APP_ID = "yaohezi";

/** Product registration carries no health subjects or family grants. */
export function seedYaohezi(seed: DatabaseSeed): void {
  seed.apps.push({ id: YAOHEZI_APP_ID, code: YAOHEZI_APP_ID, name: "药盒子",
    nameI18n: { "zh-CN": "药盒子", "en-US": "Yaohezi" }, status: "ACTIVE", joinMode: "AUTO",
    createdAt: "2026-10-30T00:00:00Z" });
  seed.roles.push({ id: "role_yaohezi_member", appId: YAOHEZI_APP_ID, code: "member", name: "Member", status: "ACTIVE" });
  seed.appConfigs.push({ id: "cfg_yaohezi_default_role", appId: YAOHEZI_APP_ID, configKey: "auth.default_role_code",
    configValue: "member", updatedAt: "2026-10-30T00:00:00Z" });
  seed.appConfigs.push({ id: "cfg_yaohezi_features", appId: YAOHEZI_APP_ID, configKey: "yaohezi.features",
    configValue: JSON.stringify({ cloudSync: false, familySharing: false, reportAI: false, subscriptionSales: false }),
    updatedAt: "2026-10-30T00:00:00Z" });
}
