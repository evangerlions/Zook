import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCache } from "../../src/infrastructure/cache/redis/in-memory-cache.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { VersionedAppConfigService } from "../../src/services/versioned-app-config.service.ts";
import { AppI18nConfigService } from "../../src/services/app-i18n-config.service.ts";
import { RequestLocaleService } from "../../src/services/request-locale.service.ts";
import { PublicApiMessageService } from "../../src/services/public-api-message.service.ts";
import { ApplicationError } from "../../src/shared/errors.ts";
import { DEFAULT_APP_I18N_SETTINGS, localizeFields, pickI18nText, resolveI18nText } from "../../src/shared/i18n.ts";
import type { HttpRequest, I18nSettings } from "../../src/shared/types.ts";

async function createI18nFixture() {
  const kvManager = await KVManager.create({
    backend: new InMemoryKVBackend(),
  });
  const database = new InMemoryDatabase();
  const cache = new InMemoryCache();
  const appConfigService = new VersionedAppConfigService(database, cache, kvManager);
  const appI18nConfigService = new AppI18nConfigService(appConfigService);

  return {
    kvManager,
    database,
    cache,
    appConfigService,
    appI18nConfigService,
  };
}

function createRequest(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: "GET",
    path: "/api/v1/demo",
    headers: {},
    ...overrides,
  };
}

const SETTINGS: I18nSettings = {
  defaultLocale: "en-US",
  supportedLocales: ["en-US", "zh-CN", "zh-TW", "ja-JP"],
  fallbackLocales: {
    "en-GB": ["en-US"],
    "zh-HK": ["zh-TW", "zh-CN"],
  },
};

test("pickI18nText resolves exact, configured fallback, and default locale matches", () => {
  assert.equal(
    pickI18nText(
      {
        "zh-CN": "欢迎使用",
        "en-US": "Welcome",
      },
      "en-US",
      SETTINGS,
    ),
    "Welcome",
  );

  const zhHkResult = resolveI18nText(
    {
      "zh-CN": "欢迎使用",
      "zh-TW": "歡迎使用",
    },
    "zh-HK",
    SETTINGS,
  );
  assert.equal(zhHkResult.text, "歡迎使用");
  assert.equal(zhHkResult.locale, "zh-TW");
  assert.equal(zhHkResult.matchType, "configured_fallback");

  const defaultResult = resolveI18nText(
    {
      "en-US": "Welcome",
      "ja-JP": "ようこそ",
    },
    "fr-FR",
    SETTINGS,
  );
  assert.equal(defaultResult.text, "Welcome");
  assert.equal(defaultResult.locale, "en-US");
  assert.equal(defaultResult.matchType, "default");
});

test("localizeFields derives localized fields from *_i18n maps and can remove source fields", () => {
  const localized = localizeFields(
    {
      id: "banner_1",
      title_i18n: {
        "zh-CN": "限时优惠",
        "en-US": "Limited Offer",
      },
      subtitle_i18n: {
        "zh-CN": "新用户首月免费",
        "en-US": "First month free for new users",
      },
    },
    ["title", "subtitle"],
    "en-US",
    SETTINGS,
    {
      removeSourceFields: true,
    },
  ) as Record<string, unknown>;

  assert.equal(localized.title, "Limited Offer");
  assert.equal(localized.subtitle, "First month free for new users");
  assert.equal("title_i18n" in localized, false);
  assert.equal("subtitle_i18n" in localized, false);
});

test("request locale service resolves locale from query/header/accept-language with supported locale fallback", () => {
  const service = new RequestLocaleService();

  const queryResult = service.resolve(
    createRequest({
      query: {
        locale: "zh-HK",
      },
    }),
    {
      appDefaultLocale: "en-US",
      supportedLocales: SETTINGS.supportedLocales,
      fallbackLocales: SETTINGS.fallbackLocales,
    },
  );

  assert.equal(queryResult.locale, "zh-TW");
  assert.equal(queryResult.localeSource, "query");
  assert.equal(queryResult.matchType, "configured_fallback");

  const headerResult = service.resolve(
    createRequest({
      headers: {
        "x-app-locale": "ja-JP",
      },
    }),
    {
      appDefaultLocale: "en-US",
      supportedLocales: SETTINGS.supportedLocales,
      fallbackLocales: SETTINGS.fallbackLocales,
    },
  );

  assert.equal(headerResult.locale, "ja-JP");
  assert.equal(headerResult.localeSource, "app_header");
  assert.equal(headerResult.matchType, "exact");

  const acceptLanguageResult = service.resolve(
    createRequest({
      headers: {
        "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
    }),
    {
      appDefaultLocale: "en-US",
      supportedLocales: SETTINGS.supportedLocales,
      fallbackLocales: SETTINGS.fallbackLocales,
    },
  );

  assert.equal(acceptLanguageResult.locale, "en-US");
  assert.equal(acceptLanguageResult.localeSource, "accept_language");
  assert.equal(acceptLanguageResult.matchType, "default");
});

test("public API message service localizes representative frontend-visible errors", () => {
  const service = new PublicApiMessageService();
  const zhHeaderRequest = createRequest({
    headers: {
      "x-app-locale": "zh-CN",
    },
  });
  const zhAcceptLanguageRequest = createRequest({
    headers: {
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  const frenchLocaleRequest = createRequest({
    headers: {
      "x-app-locale": "fr-FR",
    },
  });

  assert.equal(service.resolveLocale(zhHeaderRequest), "zh-CN");
  assert.equal(service.resolveLocale(zhAcceptLanguageRequest), "zh-CN");
  assert.equal(
    service.resolveLocale(createRequest({ headers: { "x-app-locale": "zh-HK" } })),
    "zh-TW",
  );
  assert.equal(service.resolveLocale(frenchLocaleRequest), "fr-FR");
  assert.equal(
    service.fromErrorCode("AUTH_INVALID_TOKEN", zhHeaderRequest),
    "当前登录态无效，请重新登录。",
  );
  assert.equal(
    service.fromErrorCode("AUTH_ACCOUNT_NOT_FOUND", zhHeaderRequest),
    "账号不存在。",
  );
  assert.equal(
    service.fromErrorCode("AUTH_PASSWORD_NOT_SET", zhHeaderRequest),
    "该账号未设置密码，请使用验证码登录。",
  );
  assert.equal(
    service.fromErrorCode("AI_UPSTREAM_TIMEOUT", zhHeaderRequest),
    "AI 服务响应超时，请重试。",
  );
  assert.equal(
    service.fromErrorCode("LOG_TASK_MISMATCH", zhHeaderRequest),
    "日志上传任务不可用，请重新拉取任务后重试。",
  );
  assert.equal(
    service.fromErrorCode("APP_MEMBER_BLOCKED", zhHeaderRequest),
    "你在当前应用中的访问暂不可用。",
  );
  assert.equal(
    service.fromErrorCode("FILE_ACCESS_DENIED", zhHeaderRequest),
    "你没有权限访问该文件。",
  );
  assert.equal(
    service.fromErrorCode("REQ_INVALID_EVENT", zhHeaderRequest),
    "埋点事件不合法，请检查后重试。",
  );
  assert.equal(
    service.fromErrorCode("REQ_INVALID_HEADER", frenchLocaleRequest),
    "Request headers are invalid. Please review them and try again.",
  );
});

test("public API message service resolves every supported product locale", () => {
  const service = new PublicApiMessageService();
  const locales = [
    "en-US", "zh-CN", "zh-TW", "ja-JP", "es-ES", "pt-BR", "ko-KR",
    "de-DE", "fr-FR", "hi-IN", "id-ID", "it-IT", "tr-TR", "vi-VN",
    "th-TH", "pl-PL", "nl-NL", "sv-SE", "bn-BD", "sw-KE",
  ];

  for (const locale of locales) {
    const request = createRequest({ headers: { "x-app-locale": locale } });
    assert.equal(service.resolveLocale(request), locale);
    assert.ok(service.fromErrorCode("AUTH_INVALID_TOKEN", request));
  }
});

test("app i18n config service stores normalized settings and revisions", async () => {
  const fixture = await createI18nFixture();

  await fixture.appI18nConfigService.initializeAppConfig("app_a");
  const initial = await fixture.appI18nConfigService.getDocument("app_a");

  assert.equal(initial.configKey, "i18n.settings");
  assert.equal(initial.revision, 1);
  assert.equal(initial.config.defaultLocale, DEFAULT_APP_I18N_SETTINGS.defaultLocale);
  assert.deepEqual(initial.config.supportedLocales, DEFAULT_APP_I18N_SETTINGS.supportedLocales);

  const updated = await fixture.appI18nConfigService.updateConfig("app_a", {
    defaultLocale: "en-US",
    supportedLocales: ["en-US", "zh-CN", "ja-JP"],
    fallbackLocales: {
      "en-GB": ["en-US"],
      "zh-HK": ["zh-CN"],
    },
  }, "enable-ja");

  assert.equal(updated.revision, 2);
  assert.equal(updated.config.defaultLocale, "en-US");
  assert.deepEqual(updated.config.supportedLocales, ["en-US", "zh-CN", "ja-JP"]);
  assert.deepEqual(updated.config.fallbackLocales["zh-HK"], ["zh-CN"]);

  const restored = await fixture.appI18nConfigService.restoreConfig("app_a", 1);
  assert.equal(restored.revision, 3);
  assert.equal(restored.config.defaultLocale, DEFAULT_APP_I18N_SETTINGS.defaultLocale);
});

test("app i18n config service rejects unsupported fallback locales", async () => {
  const fixture = await createI18nFixture();

  await assert.rejects(
    () => fixture.appI18nConfigService.updateConfig("app_a", {
      defaultLocale: "en-US",
      supportedLocales: ["en-US", "zh-CN"],
      fallbackLocales: {
        "zh-HK": ["ja-JP"],
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ApplicationError);
      assert.equal(error.code, "ADMIN_I18N_INVALID");
      assert.match(error.message, /Fallback locale ja-JP must exist in supportedLocales/);
      return true;
    },
  );
});

test("app i18n config service follows latest revision even if direct config record is stale", async () => {
  const fixture = await createI18nFixture();

  await fixture.appI18nConfigService.initializeAppConfig("app_a");
  await fixture.appI18nConfigService.updateConfig("app_a", {
    defaultLocale: "zh-CN",
    supportedLocales: ["zh-CN", "en-US"],
    fallbackLocales: {
      "zh-HK": ["zh-CN"],
    },
  }, "switch-default-locale");

  const staleRecord = fixture.database.appConfigs.find(
    (item) => item.appId === "app_a" && item.configKey === "i18n.settings",
  );
  assert.ok(staleRecord);
  staleRecord.configValue = JSON.stringify(DEFAULT_APP_I18N_SETTINGS, null, 2);
  staleRecord.updatedAt = "2026-04-03T10:00:00.000Z";

  const document = await fixture.appI18nConfigService.getDocument("app_a");
  assert.equal(document.config.defaultLocale, "zh-CN");
  assert.deepEqual(document.config.supportedLocales, ["zh-CN", "en-US"]);

  const current = await fixture.appI18nConfigService.getCurrentConfig("app_a");
  assert.equal(current.defaultLocale, "zh-CN");
  assert.deepEqual(current.supportedLocales, ["zh-CN", "en-US"]);
});
