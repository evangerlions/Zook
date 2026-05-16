import type { DatabaseSeed } from "../../../shared/types.ts";
import { DevelopmentPasswordHasher } from "../../../modules/auth/password-hasher.ts";
import { DEFAULT_APP_I18N_SETTINGS } from "../../../shared/i18n.ts";

/**
 * buildDefaultSeed gives the scaffold a working shared-account dataset for local verification.
 */
export function buildDefaultSeed(
  passwordHasher = new DevelopmentPasswordHasher(),
): DatabaseSeed {
  const defaultI18nSettings = JSON.stringify(
    DEFAULT_APP_I18N_SETTINGS,
    null,
    2,
  );

  return {
    apps: [
      {
        id: "app_a",
        code: "app_a",
        name: "App A",
        nameI18n: {
          "zh-CN": "应用 A",
          "en-US": "App A",
        },
        status: "ACTIVE",
        apiDomain: "app-a.example.com",
        joinMode: "AUTO",
        createdAt: "2026-03-01T09:00:00+08:00",
      },
      {
        id: "app_b",
        code: "app_b",
        name: "App B",
        nameI18n: {
          "zh-CN": "应用 B",
          "en-US": "App B",
        },
        status: "ACTIVE",
        apiDomain: "app-b.example.com",
        joinMode: "INVITE_ONLY",
        createdAt: "2026-03-01T09:00:00+08:00",
      },
      {
        id: "ai_novel",
        code: "ai_novel",
        name: "AI Novel",
        nameI18n: {
          "zh-CN": "AI 小说",
          "en-US": "AI Novel",
        },
        status: "ACTIVE",
        apiDomain: "ai-novel.example.com",
        joinMode: "AUTO",
        createdAt: "2026-03-01T09:00:00+08:00",
      },
    ],
    users: [
      {
        id: "user_alice",
        email: "alice@example.com",
        passwordHash: passwordHasher.hash("Password1234"),
        passwordAlgo: passwordHasher.algorithm,
        status: "ACTIVE",
        createdAt: "2026-03-01T09:00:00+08:00",
      },
      {
        id: "user_bob",
        email: "bob@example.com",
        passwordHash: passwordHasher.hash("Password1234"),
        passwordAlgo: passwordHasher.algorithm,
        status: "ACTIVE",
        createdAt: "2026-03-01T09:30:00+08:00",
      },
      {
        id: "user_blocked",
        email: "blocked@example.com",
        passwordHash: passwordHasher.hash("Password1234"),
        passwordAlgo: passwordHasher.algorithm,
        status: "BLOCKED",
        createdAt: "2026-03-01T10:00:00+08:00",
      },
    ],
    appUsers: [
      {
        id: "app_user_alice_a",
        appId: "app_a",
        userId: "user_alice",
        status: "ACTIVE",
        joinedAt: "2026-03-01T09:00:00+08:00",
      },
      {
        id: "app_user_alice_b",
        appId: "app_b",
        userId: "user_alice",
        status: "ACTIVE",
        joinedAt: "2026-03-02T09:00:00+08:00",
      },
    ],
    roles: [
      { id: "role_app_a_member", appId: "app_a", code: "member", name: "Member", status: "ACTIVE" },
      { id: "role_app_a_admin", appId: "app_a", code: "admin", name: "Admin", status: "ACTIVE" },
      { id: "role_app_b_member", appId: "app_b", code: "member", name: "Member", status: "ACTIVE" },
      { id: "role_app_b_admin", appId: "app_b", code: "admin", name: "Admin", status: "ACTIVE" },
      { id: "role_ai_novel_member", appId: "ai_novel", code: "member", name: "Member", status: "ACTIVE" },
      { id: "role_ai_novel_admin", appId: "ai_novel", code: "admin", name: "Admin", status: "ACTIVE" },
    ],
    permissions: [
      { id: "perm_metrics_read", code: "metrics:read", name: "Read metrics", status: "ACTIVE" },
      { id: "perm_file_read", code: "file:read", name: "Read files", status: "ACTIVE" },
      {
        id: "perm_notification_send",
        code: "notification:send",
        name: "Send notifications",
        status: "ACTIVE",
      },
    ],
    rolePermissions: [
      { id: "rp_app_a_member_file", roleId: "role_app_a_member", permissionId: "perm_file_read" },
      { id: "rp_app_a_admin_file", roleId: "role_app_a_admin", permissionId: "perm_file_read" },
      { id: "rp_app_a_admin_metrics", roleId: "role_app_a_admin", permissionId: "perm_metrics_read" },
      {
        id: "rp_app_a_admin_notification",
        roleId: "role_app_a_admin",
        permissionId: "perm_notification_send",
      },
      { id: "rp_app_b_member_file", roleId: "role_app_b_member", permissionId: "perm_file_read" },
      { id: "rp_app_b_admin_file", roleId: "role_app_b_admin", permissionId: "perm_file_read" },
      { id: "rp_app_b_admin_metrics", roleId: "role_app_b_admin", permissionId: "perm_metrics_read" },
    ],
    userRoles: [
      { id: "ur_alice_app_a_admin", appId: "app_a", userId: "user_alice", roleId: "role_app_a_admin" },
      { id: "ur_alice_app_b_admin", appId: "app_b", userId: "user_alice", roleId: "role_app_b_admin" },
    ],
    refreshTokens: [],
    auditLogs: [],
    notificationJobs: [],
    failedEvents: [],
    appConfigs: [
      {
        id: "cfg_app_a_default_role",
        appId: "app_a",
        configKey: "auth.default_role_code",
        configValue: "member",
        updatedAt: "2026-03-01T09:00:00+08:00",
      },
      {
        id: "cfg_app_a_delivery_config",
        appId: "app_a",
        configKey: "admin.delivery_config",
        configValue: JSON.stringify(
          {
            release: {
              version: "2026.03.20",
              channel: "stable",
            },
            featureFlags: {
              showOnboarding: true,
              enableVipBanner: false,
            },
            settings: {
              theme: "spring",
              apiBasePath: "/api/v1",
            },
          },
          null,
          2,
        ),
        updatedAt: "2026-03-20T09:00:00+08:00",
      },
      {
        id: "cfg_app_a_i18n_settings",
        appId: "app_a",
        configKey: "i18n.settings",
        configValue: defaultI18nSettings,
        updatedAt: "2026-03-20T09:05:00+08:00",
      },
      {
        id: "cfg_app_b_default_role",
        appId: "app_b",
        configKey: "auth.default_role_code",
        configValue: "member",
        updatedAt: "2026-03-01T09:00:00+08:00",
      },
      {
        id: "cfg_app_b_delivery_config",
        appId: "app_b",
        configKey: "admin.delivery_config",
        configValue: JSON.stringify(
          {
            release: {
              version: "2026.03.18",
              channel: "beta",
            },
            featureFlags: {
              showOnboarding: false,
              enableVipBanner: true,
            },
            settings: {
              theme: "midnight",
              apiBasePath: "/api/v1",
            },
          },
          null,
          2,
        ),
        updatedAt: "2026-03-20T09:10:00+08:00",
      },
      {
        id: "cfg_app_b_i18n_settings",
        appId: "app_b",
        configKey: "i18n.settings",
        configValue: defaultI18nSettings,
        updatedAt: "2026-03-20T09:15:00+08:00",
      },
      {
        id: "cfg_ai_novel_default_role",
        appId: "ai_novel",
        configKey: "auth.default_role_code",
        configValue: "member",
        updatedAt: "2026-03-01T09:00:00+08:00",
      },
      {
        id: "cfg_ai_novel_delivery_config",
        appId: "ai_novel",
        configKey: "admin.delivery_config",
        configValue: JSON.stringify(
          {
            app: "ai_novel",
            kickoff: {
              recommendedPrompts: [
                "写一本经典玄幻升级流，主角从被逐出宗门开始。",
                "写一个女频重生复仇故事，但情感线要克制一点。",
                "帮我规划一个轻松都市异能长篇，节奏要爽快。",
                "写一个规则怪谈方向的悬疑故事，气氛压迫一点。",
                "写一个轻松日常向故事，带一点反差脑洞。",
                "写一个群像冒险故事，每个人都有明显成长线。",
                "写一个古风权谋复仇故事，情绪克制但刀口很准。",
                "写一个赛博都市异能故事，节奏快一点。",
                "写一个校园超自然故事，从一个异常事件开始。",
                "写一个末世生存升级故事，开局就有强冲突。",
              ],
            },
          },
          null,
          2,
        ),
        updatedAt: "2026-03-20T09:20:00+08:00",
      },
      {
        id: "cfg_ai_novel_i18n_settings",
        appId: "ai_novel",
        configKey: "i18n.settings",
        configValue: defaultI18nSettings,
        updatedAt: "2026-03-20T09:25:00+08:00",
      },
    ],
    analyticsEvents: [],
    files: [],
  };
}
