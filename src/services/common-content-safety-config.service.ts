import { VersionedAppConfigService } from "./versioned-app-config.service.ts";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import type {
  AdminAppSummary,
  AdminContentSafetyDocument,
  ContentSafetyAliyunConfig,
  ContentSafetyConfig,
  ContentSafetyKeywordRule,
  ContentSafetyLlmConfig,
} from "../shared/types.ts";

const COMMON_APP_ID = "common";
export const CONTENT_SAFETY_CONFIG_KEY = "common.content_safety";
export const CONTENT_SAFETY_MANAGE_OPERATION = "content_safety.sensitive_words.manage";
const DEFAULT_ALIYUN_ENDPOINT = "https://green-cip.cn-shanghai.aliyuncs.com";
const DEFAULT_ALIYUN_SERVICE = "chat_detection";
const DEFAULT_LLM_MODEL_KEY = "qwen3.5-flash";
const DEFAULT_THRESHOLD_CHARS = 2000;
const DEFAULT_TIMEOUT_MS = 5000;
const KEYWORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const PASSWORD_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const COMMON_APP_SUMMARY: AdminAppSummary = {
  appId: COMMON_APP_ID,
  appCode: COMMON_APP_ID,
  appName: "服务端配置",
  appNameI18n: {
    "zh-CN": "服务端配置",
    "en-US": "Server Config",
  },
  status: "ACTIVE",
  canDelete: false,
  logSecret: {
    keyId: "common",
    secretMasked: "",
    updatedAt: "",
  },
};

export class CommonContentSafetyConfigService {
  constructor(private readonly appConfigService: VersionedAppConfigService) {}

  async getDocument(revision?: number): Promise<AdminContentSafetyDocument> {
    const revisions = await this.appConfigService.listRevisions(COMMON_APP_ID, CONTENT_SAFETY_CONFIG_KEY);
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(COMMON_APP_ID, CONTENT_SAFETY_CONFIG_KEY, revision)
      : await this.appConfigService.getLatestRevision(COMMON_APP_ID, CONTENT_SAFETY_CONFIG_KEY);

    if (revision && !record) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Content safety revision ${revision} was not found.`);
    }

    const config = record ? this.parseConfig(record.content) : await this.getCurrentConfig();

    return {
      app: COMMON_APP_SUMMARY,
      configKey: CONTENT_SAFETY_CONFIG_KEY,
      config,
      updatedAt: record?.createdAt ?? await this.appConfigService.getUpdatedAt(COMMON_APP_ID, CONTENT_SAFETY_CONFIG_KEY),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
      revisions: [...revisions].reverse(),
    };
  }

  async updateConfig(input: unknown, desc?: string): Promise<AdminContentSafetyDocument> {
    const normalized = this.validateInput(input);
    await this.appConfigService.setValue(
      COMMON_APP_ID,
      CONTENT_SAFETY_CONFIG_KEY,
      JSON.stringify(normalized, null, 2),
      desc?.trim() || "common-content-safety-update",
    );
    return this.getDocument();
  }

  async restoreConfig(revision: number, desc?: string): Promise<AdminContentSafetyDocument> {
    const existing = await this.appConfigService.getRevision(COMMON_APP_ID, CONTENT_SAFETY_CONFIG_KEY, revision);
    if (!existing) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Content safety revision ${revision} was not found.`);
    }

    await this.appConfigService.restoreValue(
      COMMON_APP_ID,
      CONTENT_SAFETY_CONFIG_KEY,
      revision,
      desc?.trim() || `恢复到版本 R${revision}`,
    );

    return this.getDocument();
  }

  async getCurrentConfig(): Promise<ContentSafetyConfig> {
    const stored = await this.appConfigService.getValue(COMMON_APP_ID, CONTENT_SAFETY_CONFIG_KEY);
    return stored ? this.parseConfig(stored) : this.createDefaultConfig();
  }

  private parseConfig(raw: string): ContentSafetyConfig {
    try {
      return this.validateInput(JSON.parse(raw));
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored content safety config is invalid.");
    }
  }

  private createDefaultConfig(): ContentSafetyConfig {
    return {
      enabled: false,
      longTextThresholdChars: DEFAULT_THRESHOLD_CHARS,
      keyword: {
        enabled: true,
        rules: [],
      },
      llm: {
        enabled: true,
        modelKey: DEFAULT_LLM_MODEL_KEY,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      },
      aliyun: {
        enabled: false,
        endpoint: DEFAULT_ALIYUN_ENDPOINT,
        region: "cn-shanghai",
        service: DEFAULT_ALIYUN_SERVICE,
        accessKeyIdPasswordKey: "",
        accessKeySecretPasswordKey: "",
        timeoutMs: DEFAULT_TIMEOUT_MS,
      },
    };
  }

  private validateInput(input: unknown): ContentSafetyConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("REQ_INVALID_BODY", "Content safety config must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    const config: ContentSafetyConfig = {
      enabled: Boolean(source.enabled),
      longTextThresholdChars: this.normalizePositiveInteger(
        source.longTextThresholdChars,
        DEFAULT_THRESHOLD_CHARS,
        "longTextThresholdChars",
      ),
      keyword: this.normalizeKeywordConfig(source.keyword),
      llm: this.normalizeLlmConfig(source.llm),
      aliyun: this.normalizeAliyunConfig(source.aliyun),
    };

    return config;
  }

  private normalizeKeywordConfig(value: unknown): ContentSafetyConfig["keyword"] {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const rulesValue = source.rules;
    const rules = Array.isArray(rulesValue)
      ? rulesValue.map((item, index) => this.normalizeKeywordRule(item, index))
      : [];
    const ids = new Set<string>();
    const terms = new Set<string>();

    for (const rule of rules) {
      if (ids.has(rule.id)) {
        badRequest("REQ_INVALID_BODY", `Duplicate sensitive word id is not allowed: ${rule.id}`);
      }
      ids.add(rule.id);
      const normalizedTerm = normalizeText(rule.term);
      if (terms.has(normalizedTerm)) {
        badRequest("REQ_INVALID_BODY", `Duplicate sensitive word term is not allowed: ${rule.term}`);
      }
      terms.add(normalizedTerm);
    }

    return {
      enabled: source.enabled !== false,
      rules,
    };
  }

  private normalizeKeywordRule(value: unknown, index: number): ContentSafetyKeywordRule {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      badRequest("REQ_INVALID_BODY", `Sensitive word #${index + 1} must be a JSON object.`);
    }

    const source = value as Record<string, unknown>;
    const id = this.optionalString(source.id) || `kw_${index + 1}`;
    const term = this.optionalString(source.term);
    if (!KEYWORD_ID_PATTERN.test(id)) {
      badRequest("REQ_INVALID_BODY", `Sensitive word id is invalid: ${id}`);
    }
    if (!term) {
      badRequest("REQ_INVALID_BODY", `Sensitive word #${index + 1} term is required.`);
    }

    return {
      id,
      term,
      enabled: source.enabled !== false,
      ...(this.optionalString(source.category) ? { category: this.optionalString(source.category) } : {}),
      ...(this.optionalString(source.note) ? { note: this.optionalString(source.note) } : {}),
    };
  }

  private normalizeLlmConfig(value: unknown): ContentSafetyLlmConfig {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    return {
      enabled: source.enabled !== false,
      modelKey: this.optionalString(source.modelKey) || DEFAULT_LLM_MODEL_KEY,
      timeoutMs: this.normalizePositiveInteger(source.timeoutMs, DEFAULT_TIMEOUT_MS, "llm.timeoutMs"),
    };
  }

  private normalizeAliyunConfig(value: unknown): ContentSafetyAliyunConfig {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const config = {
      enabled: Boolean(source.enabled),
      endpoint: this.normalizeEndpoint(source.endpoint) || DEFAULT_ALIYUN_ENDPOINT,
      region: this.optionalString(source.region) || "cn-shanghai",
      service: this.optionalString(source.service) || DEFAULT_ALIYUN_SERVICE,
      accessKeyIdPasswordKey: this.optionalString(source.accessKeyIdPasswordKey),
      accessKeySecretPasswordKey: this.optionalString(source.accessKeySecretPasswordKey),
      timeoutMs: this.normalizePositiveInteger(source.timeoutMs, DEFAULT_TIMEOUT_MS, "aliyun.timeoutMs"),
    };

    for (const [key, passwordKey] of [
      ["accessKeyIdPasswordKey", config.accessKeyIdPasswordKey],
      ["accessKeySecretPasswordKey", config.accessKeySecretPasswordKey],
    ] as const) {
      if (passwordKey && !PASSWORD_KEY_PATTERN.test(passwordKey)) {
        badRequest("REQ_INVALID_BODY", `${key} is invalid: ${passwordKey}`);
      }
    }

    return config;
  }

  private normalizeEndpoint(value: unknown): string {
    const normalized = this.optionalString(value).replace(/\/+$/, "");
    if (!normalized) {
      return "";
    }
    if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(normalized)) {
      badRequest("REQ_INVALID_BODY", "aliyun.endpoint must be an https origin.");
    }
    return normalized;
  }

  private normalizePositiveInteger(value: unknown, fallback: number, field: string): number {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      badRequest("REQ_INVALID_BODY", `${field} must be a positive number.`);
    }
    return Math.round(value);
  }

  private optionalString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}
