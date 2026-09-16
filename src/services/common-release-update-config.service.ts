import { VersionedAppConfigService } from "./versioned-app-config.service.ts";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import { isI18nText, normalizeLocale } from "../shared/i18n.ts";
import type {
  AdminAppSummary,
  AdminReleaseUpdateDocument,
  PublicReleaseUpdateConfig,
  ReleaseUpdateArtifact,
  ReleaseUpdateConfig,
  ReleaseUpdateDelivery,
  ReleaseUpdateExperiment,
  ReleaseUpdatePlatform,
  ReleaseUpdateReminderPolicy,
  ReleaseUpdateTarget,
  ReleaseVersion,
} from "../shared/types.ts";

const COMMON_APP_ID = "common";
export const RELEASE_UPDATE_CONFIG_KEY = "common.release_updates";
const SCHEMA_VERSION = 1;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const DEFAULT_REMINDER_INTERVAL_SECONDS = 24 * 60 * 60;
const DEFAULT_OPTIONAL_REMINDER_COUNT = 3;
const SUPPORTED_PLATFORMS = new Set<ReleaseUpdatePlatform>([
  "android",
  "ios",
  "ohos",
  "windows",
  "web",
]);
const SUPPORTED_DELIVERIES = new Set<ReleaseUpdateDelivery>(["download", "store"]);

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
    keyId: COMMON_APP_ID,
    secretMasked: "",
    updatedAt: "",
  },
};

export class CommonReleaseUpdateConfigService {
  constructor(private readonly appConfigService: VersionedAppConfigService) {}

  async getDocument(revision?: number): Promise<AdminReleaseUpdateDocument> {
    const revisions = await this.appConfigService.listRevisions(COMMON_APP_ID, RELEASE_UPDATE_CONFIG_KEY);
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(COMMON_APP_ID, RELEASE_UPDATE_CONFIG_KEY, revision)
      : await this.appConfigService.getLatestRevision(COMMON_APP_ID, RELEASE_UPDATE_CONFIG_KEY);

    if (revision && !record) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Release update revision ${revision} was not found.`);
    }

    const config = record ? this.parseConfig(record.content) : await this.getCurrentConfig();
    return {
      app: COMMON_APP_SUMMARY,
      configKey: RELEASE_UPDATE_CONFIG_KEY,
      config,
      updatedAt: record?.createdAt ?? await this.appConfigService.getUpdatedAt(COMMON_APP_ID, RELEASE_UPDATE_CONFIG_KEY),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
      revisions: [...revisions].reverse(),
    };
  }

  async updateConfig(input: unknown, desc?: string): Promise<AdminReleaseUpdateDocument> {
    const normalized = this.validateInput(input);
    await this.appConfigService.setValue(
      COMMON_APP_ID,
      RELEASE_UPDATE_CONFIG_KEY,
      JSON.stringify(normalized, null, 2),
      desc?.trim() || "common-release-updates-update",
    );
    return this.getDocument();
  }

  async restoreConfig(revision: number, desc?: string): Promise<AdminReleaseUpdateDocument> {
    const existing = await this.appConfigService.getRevision(COMMON_APP_ID, RELEASE_UPDATE_CONFIG_KEY, revision);
    if (!existing) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Release update revision ${revision} was not found.`);
    }

    await this.appConfigService.restoreValue(
      COMMON_APP_ID,
      RELEASE_UPDATE_CONFIG_KEY,
      revision,
      desc?.trim() || `恢复到版本 R${revision}`,
    );
    return this.getDocument();
  }

  async initializeDefaultConfig(desc = "common-release-updates-init"): Promise<boolean> {
    if (await this.appConfigService.getValue(COMMON_APP_ID, RELEASE_UPDATE_CONFIG_KEY)) {
      return false;
    }

    await this.appConfigService.setValue(
      COMMON_APP_ID,
      RELEASE_UPDATE_CONFIG_KEY,
      JSON.stringify(this.createDefaultConfig(), null, 2),
      desc,
    );
    return true;
  }

  async getCurrentConfig(): Promise<ReleaseUpdateConfig> {
    const stored = await this.appConfigService.getValue(COMMON_APP_ID, RELEASE_UPDATE_CONFIG_KEY);
    return stored ? this.parseConfig(stored) : this.createDefaultConfig();
  }

  async getPublicConfig(productKey: string): Promise<{
    config: PublicReleaseUpdateConfig;
    updatedAt?: string;
  }> {
    const config = await this.getCurrentConfig();
    const product = config.products[productKey];
    return {
      config: {
        schemaVersion: SCHEMA_VERSION,
        targets: (product?.targets ?? [])
          .filter((target) => target.enabled)
          .map((target) => ({
            ...target,
            experiments: target.experiments.filter((experiment) => experiment.enabled),
          })),
      },
      updatedAt: await this.appConfigService.getUpdatedAt(COMMON_APP_ID, RELEASE_UPDATE_CONFIG_KEY),
    };
  }

  private createDefaultConfig(): ReleaseUpdateConfig {
    return {
      schemaVersion: SCHEMA_VERSION,
      products: {},
    };
  }

  private parseConfig(raw: string): ReleaseUpdateConfig {
    try {
      return this.validateInput(JSON.parse(raw));
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored release update config is invalid.");
    }
  }

  private validateInput(input: unknown): ReleaseUpdateConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("REQ_INVALID_BODY", "Release update config must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    if (source.schemaVersion !== SCHEMA_VERSION) {
      badRequest("REQ_INVALID_BODY", `schemaVersion must be ${SCHEMA_VERSION}.`);
    }
    if (!source.products || typeof source.products !== "object" || Array.isArray(source.products)) {
      badRequest("REQ_INVALID_BODY", "products must be a JSON object.");
    }

    const products: Record<string, { targets: ReleaseUpdateTarget[] }> = {};
    for (const [productKey, value] of Object.entries(source.products as Record<string, unknown>)) {
      if (!IDENTIFIER_PATTERN.test(productKey)) {
        badRequest("REQ_INVALID_BODY", `Invalid product key: ${productKey}`);
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        badRequest("REQ_INVALID_BODY", `products.${productKey} must be a JSON object.`);
      }

      const product = value as Record<string, unknown>;
      if (!Array.isArray(product.targets)) {
        badRequest("REQ_INVALID_BODY", `products.${productKey}.targets must be an array.`);
      }

      const targetIds = new Set<string>();
      const targetKeys = new Set<string>();
      const targets = product.targets.map((target, index) => {
        const normalized = this.normalizeTarget(target, `products.${productKey}.targets[${index}]`);
        if (targetIds.has(normalized.id)) {
          badRequest("REQ_INVALID_BODY", `Duplicate release target id: ${normalized.id}`);
        }
        const targetKey = `${normalized.platform}:${normalized.channel}`;
        if (targetKeys.has(targetKey)) {
          badRequest("REQ_INVALID_BODY", `Duplicate release target: ${targetKey}`);
        }
        targetIds.add(normalized.id);
        targetKeys.add(targetKey);
        return normalized;
      });

      products[productKey] = { targets };
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      products,
    };
  }

  private normalizeTarget(value: unknown, path: string): ReleaseUpdateTarget {
    const source = this.requireObject(value, path);
    const id = this.requireIdentifier(source.id, `${path}.id`);
    const platform = this.requireEnum(source.platform, SUPPORTED_PLATFORMS, `${path}.platform`) as ReleaseUpdatePlatform;
    const channel = this.requireIdentifier(source.channel, `${path}.channel`);
    const delivery = this.requireEnum(source.delivery, SUPPORTED_DELIVERIES, `${path}.delivery`) as ReleaseUpdateDelivery;
    const enabled = this.requireBoolean(source.enabled, `${path}.enabled`, true);
    const mandatory = this.requireBoolean(source.mandatory, `${path}.mandatory`, false);
    const latest = this.normalizeArtifact(source.latest, `${path}.latest`, delivery, platform);
    const minimumSupported = source.minimumSupported === undefined
      ? undefined
      : this.normalizeVersion(source.minimumSupported, `${path}.minimumSupported`);
    const reminder = this.normalizeReminder(source.reminder, `${path}.reminder`, mandatory);
    const experimentsValue = source.experiments === undefined ? [] : source.experiments;
    if (!Array.isArray(experimentsValue)) {
      badRequest("REQ_INVALID_BODY", `${path}.experiments must be an array.`);
    }

    const experimentIds = new Set<string>();
    const experiments = experimentsValue.map((experiment, index) => {
      const normalized = this.normalizeExperiment(
        experiment,
        `${path}.experiments[${index}]`,
        delivery,
        platform,
      );
      if (experimentIds.has(normalized.id)) {
        badRequest("REQ_INVALID_BODY", `Duplicate release experiment id: ${normalized.id}`);
      }
      experimentIds.add(normalized.id);
      return normalized;
    });

    return {
      id,
      platform,
      channel,
      delivery,
      enabled,
      mandatory,
      latest,
      ...(minimumSupported ? { minimumSupported } : {}),
      reminder,
      experiments,
    };
  }

  private normalizeExperiment(
    value: unknown,
    path: string,
    delivery: ReleaseUpdateDelivery,
    platform: ReleaseUpdatePlatform,
  ): ReleaseUpdateExperiment {
    const source = this.requireObject(value, path);
    return {
      id: this.requireIdentifier(source.id, `${path}.id`),
      enabled: this.requireBoolean(source.enabled, `${path}.enabled`, true),
      rolloutPercent: this.requirePercent(source.rolloutPercent, `${path}.rolloutPercent`),
      artifact: this.normalizeArtifact(source.artifact, `${path}.artifact`, delivery, platform),
    };
  }

  private normalizeArtifact(
    value: unknown,
    path: string,
    delivery: ReleaseUpdateDelivery,
    platform: ReleaseUpdatePlatform,
  ): ReleaseUpdateArtifact {
    const source = this.requireObject(value, path);
    const artifact: ReleaseUpdateArtifact = {
      version: this.requireVersion(source.version, `${path}.version`),
      buildNumber: this.requirePositiveInteger(source.buildNumber, `${path}.buildNumber`),
    };

    const packageName = this.optionalText(source.packageName, `${path}.packageName`);
    const fileName = this.optionalText(source.fileName, `${path}.fileName`);
    if (fileName && /[\\/]/.test(fileName)) {
      badRequest("REQ_INVALID_BODY", `${path}.fileName must not contain a path.`);
    }
    const downloadUrl = this.optionalUrl(source.downloadUrl, `${path}.downloadUrl`);
    const storeUrl = this.optionalUrl(source.storeUrl, `${path}.storeUrl`);
    if (delivery === "download" && !downloadUrl) {
      badRequest("REQ_INVALID_BODY", `${path}.downloadUrl is required for download targets.`);
    }
    if (delivery === "store" && !storeUrl) {
      badRequest("REQ_INVALID_BODY", `${path}.storeUrl is required for store targets.`);
    }
    const sha256 = this.optionalText(source.sha256, `${path}.sha256`);
    if (sha256 && !SHA256_PATTERN.test(sha256)) {
      badRequest("REQ_INVALID_BODY", `${path}.sha256 must be a 64-character hexadecimal digest.`);
    }
    if (platform === "windows" && delivery === "download") {
      if (!fileName || !/\.exe$/i.test(fileName)) {
        badRequest("REQ_INVALID_BODY", `${path}.fileName must be a modern setup.exe artifact.`);
      }
      if (!sha256) {
        badRequest("REQ_INVALID_BODY", `${path}.sha256 is required for Windows setup.exe artifacts.`);
      }
    }
    const sizeBytes = source.sizeBytes === undefined
      ? undefined
      : this.requirePositiveInteger(source.sizeBytes, `${path}.sizeBytes`);
    const messageI18n = this.optionalI18n(source.messageI18n, `${path}.messageI18n`);

    if (packageName) artifact.packageName = packageName;
    if (fileName) artifact.fileName = fileName;
    if (downloadUrl) artifact.downloadUrl = downloadUrl;
    if (storeUrl) artifact.storeUrl = storeUrl;
    if (sha256) artifact.sha256 = sha256.toLowerCase();
    if (sizeBytes !== undefined) artifact.sizeBytes = sizeBytes;
    if (messageI18n) artifact.messageI18n = messageI18n;
    return artifact;
  }

  private optionalI18n(value: unknown, path: string): Record<string, string> | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isI18nText(value)) {
      badRequest("REQ_INVALID_BODY", `${path} must be an object of locale-to-string values.`);
    }
    const normalized = Object.fromEntries(
      Object.entries(value as Record<string, string>)
        .map(([locale, text]) => [normalizeLocale(locale) ?? locale.trim(), text.trim()] as const)
        .filter(([locale, text]) => Boolean(locale) && Boolean(text)),
    );
    return Object.keys(normalized).length ? normalized : undefined;
  }

  private normalizeVersion(value: unknown, path: string): ReleaseVersion {
    const source = this.requireObject(value, path);
    return {
      version: this.requireVersion(source.version, `${path}.version`),
      buildNumber: this.requirePositiveInteger(source.buildNumber, `${path}.buildNumber`),
    };
  }

  private normalizeReminder(value: unknown, path: string, mandatory: boolean): ReleaseUpdateReminderPolicy {
    if (value === undefined) {
      return {
        maxCount: mandatory ? 0 : DEFAULT_OPTIONAL_REMINDER_COUNT,
        intervalSeconds: DEFAULT_REMINDER_INTERVAL_SECONDS,
      };
    }

    const source = this.requireObject(value, path);
    const maxCount = source.maxCount === undefined
      ? mandatory ? 0 : DEFAULT_OPTIONAL_REMINDER_COUNT
      : this.requireNonNegativeInteger(source.maxCount, `${path}.maxCount`);
    const intervalSeconds = source.intervalSeconds === undefined
      ? DEFAULT_REMINDER_INTERVAL_SECONDS
      : this.requirePositiveInteger(source.intervalSeconds, `${path}.intervalSeconds`);
    return { maxCount, intervalSeconds };
  }

  private requireObject(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      badRequest("REQ_INVALID_BODY", `${path} must be a JSON object.`);
    }
    return value as Record<string, unknown>;
  }

  private requireIdentifier(value: unknown, path: string): string {
    const text = this.requireText(value, path);
    if (!IDENTIFIER_PATTERN.test(text)) {
      badRequest("REQ_INVALID_BODY", `${path} contains invalid characters.`);
    }
    return text;
  }

  private requireVersion(value: unknown, path: string): string {
    const text = this.requireText(value, path);
    if (!VERSION_PATTERN.test(text)) {
      badRequest("REQ_INVALID_BODY", `${path} must use x.y.z version format.`);
    }
    return text;
  }

  private requireText(value: unknown, path: string): string {
    if (typeof value !== "string" || !value.trim()) {
      badRequest("REQ_INVALID_BODY", `${path} must be a non-empty string.`);
    }
    return value.trim();
  }

  private optionalText(value: unknown, path: string): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    return this.requireText(value, path);
  }

  private optionalUrl(value: unknown, path: string): string | undefined {
    const text = this.optionalText(value, path);
    if (!text) return undefined;
    try {
      const parsed = new URL(text);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported");
    } catch {
      badRequest("REQ_INVALID_BODY", `${path} must be an HTTP(S) URL.`);
    }
    return text;
  }

  private requireEnum(value: unknown, values: Set<string>, path: string): string {
    const text = this.requireText(value, path);
    if (!values.has(text)) {
      badRequest("REQ_INVALID_BODY", `${path} is not supported.`);
    }
    return text;
  }

  private requireBoolean(value: unknown, path: string, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") badRequest("REQ_INVALID_BODY", `${path} must be a boolean.`);
    return value;
  }

  private requirePositiveInteger(value: unknown, path: string): number {
    if (!Number.isInteger(value) || Number(value) <= 0) {
      badRequest("REQ_INVALID_BODY", `${path} must be a positive integer.`);
    }
    return Number(value);
  }

  private requireNonNegativeInteger(value: unknown, path: string): number {
    if (!Number.isInteger(value) || Number(value) < 0) {
      badRequest("REQ_INVALID_BODY", `${path} must be a non-negative integer.`);
    }
    return Number(value);
  }

  private requirePercent(value: unknown, path: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
      badRequest("REQ_INVALID_BODY", `${path} must be between 0 and 100.`);
    }
    return Math.round(value * 100) / 100;
  }
}
