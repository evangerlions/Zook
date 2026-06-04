import { ApplicationError, badRequest } from "../shared/errors.ts";
import type {
  EmailSenderConfig,
  EmailServiceConfig,
  EmailServiceRegionConfig,
  EmailServiceTemplateConfig,
  TencentSesRegion,
} from "../shared/types.ts";

export const DEFAULT_EMAIL_REGION: TencentSesRegion = "ap-guangzhou";
export const DEFAULT_TEMPLATE_LOCALE = "zh-CN";
export const EMAIL_REGIONS: TencentSesRegion[] = ["ap-guangzhou", "ap-hongkong"];
export const VERIFICATION_EMAIL_TEMPLATE_NAME = "verify-code";

export function parseEmailServiceConfig(raw: string): EmailServiceConfig {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApplicationError(
      500,
      "SYS_INTERNAL_ERROR",
      "Stored email service config is invalid.",
    );
  }

  return validateEmailServiceConfig(parsed, true);
}

export function validateEmailServiceConfig(
  input: unknown,
  allowLegacyFallback = false,
): EmailServiceConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    badRequest(
      "ADMIN_EMAIL_SERVICE_INVALID",
      "Email service config must be a JSON object.",
    );
  }

  const source = input as Record<string, unknown>;
  const config: EmailServiceConfig = {
    enabled: Boolean(source.enabled),
    regions: normalizeRegions(source.regions, allowLegacyFallback),
  };

  assertUniqueTemplateIds(config.regions);

  if (!config.enabled) {
    return config;
  }

  assertVerificationTemplateNames(config.regions);

  if (!config.regions.some((item) => item.sender && item.templates.length)) {
    badRequest(
      "ADMIN_EMAIL_SERVICE_INVALID",
      "At least one region must have sender and templates configured.",
    );
  }
  return config;
}

export function createDefaultEmailServiceConfig(): EmailServiceConfig {
  return {
    enabled: false,
    regions: EMAIL_REGIONS.map((region) => ({
      region,
      sender: null,
      templates: [],
    })),
  };
}

export function assertRuntimeEmailServiceConfig(
  config: EmailServiceConfig,
): void {
  if (!config.enabled) {
    throw new ApplicationError(
      503,
      "EMAIL_SERVICE_NOT_CONFIGURED",
      "Email service is not enabled.",
    );
  }

  if (!config.regions.length) {
    throw new ApplicationError(
      503,
      "EMAIL_SERVICE_NOT_CONFIGURED",
      "Email service is not fully configured.",
    );
  }
}

export function resolveEmailProviderRegion(
  region: TencentSesRegion,
): TencentSesRegion {
  return region === "ap-guangzhou" ? "ap-guangzhou" : "ap-hongkong";
}

export function resolveEmailRegionConfig(
  regions: EmailServiceRegionConfig[],
  region: TencentSesRegion,
): EmailServiceRegionConfig {
  const regionConfig = regions.find((item) => item.region === region);
  if (regionConfig) {
    return regionConfig;
  }

  throw new ApplicationError(
    503,
    "EMAIL_SERVICE_NOT_CONFIGURED",
    `Email region is not configured: ${region}`,
  );
}

export function resolveEmailSender(
  regionConfig: EmailServiceRegionConfig,
  region: TencentSesRegion,
): EmailSenderConfig {
  if (regionConfig.sender) {
    return regionConfig.sender;
  }

  throw new ApplicationError(
    503,
    "EMAIL_SERVICE_NOT_CONFIGURED",
    `Email sender is not configured for region: ${region}`,
  );
}

export function resolveEmailTemplate(
  templates: EmailServiceTemplateConfig[],
  locale: string,
  templateName = "",
): EmailServiceTemplateConfig {
  if (!templates.length) {
    throw new ApplicationError(
      503,
      "EMAIL_SERVICE_NOT_CONFIGURED",
      "Email service template is not configured.",
    );
  }

  const normalizedLocale = normalizeEmailLocale(locale || DEFAULT_TEMPLATE_LOCALE);
  const preferredName = optionalString(templateName);
  const candidateTemplates = preferredName
    ? templates.filter((item) => item.name === preferredName)
    : templates;
  if (preferredName && !candidateTemplates.length) {
    throw new ApplicationError(
      503,
      "EMAIL_SERVICE_NOT_CONFIGURED",
      `Email template is not configured: ${preferredName}`,
    );
  }

  const scopedTemplates = candidateTemplates.length ? candidateTemplates : templates;
  const exactMatch = scopedTemplates.find((item) => item.locale === normalizedLocale);
  if (exactMatch) {
    return exactMatch;
  }

  const languageOnly = normalizedLocale.split("-")[0];
  const fallbackMatch = scopedTemplates.find((item) => item.locale === languageOnly);
  if (fallbackMatch) {
    return fallbackMatch;
  }

  const englishFallback = scopedTemplates.find((item) => item.locale === "en-US");
  return englishFallback ?? scopedTemplates[0];
}

export function resolveEmailTemplateById(
  templates: EmailServiceTemplateConfig[],
  templateId: number,
): EmailServiceTemplateConfig {
  if (!templates.length) {
    throw new ApplicationError(
      503,
      "EMAIL_SERVICE_NOT_CONFIGURED",
      "Email service template is not configured.",
    );
  }

  const template = templates.find((item) => item.templateId === templateId);
  if (template) {
    return template;
  }

  throw new ApplicationError(
    503,
    "EMAIL_SERVICE_NOT_CONFIGURED",
    `Email template is not configured: ${templateId}`,
  );
}

function normalizeRegions(
  value: unknown,
  allowLegacyFallback: boolean,
): EmailServiceRegionConfig[] {
  if (!Array.isArray(value)) {
    return createDefaultEmailServiceConfig().regions;
  }

  const regions = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      badRequest(
        "ADMIN_EMAIL_SERVICE_INVALID",
        "Each email region config must be a JSON object.",
      );
    }

    const source = item as Record<string, unknown>;
    const region = normalizeRegion(source.region);
    if (!region) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Email region is required.");
    }

    return {
      region,
      sender: normalizeSender(source.sender),
      templates: normalizeTemplates(source.templates, allowLegacyFallback),
    } satisfies EmailServiceRegionConfig;
  });

  const normalizedMap = new Map<TencentSesRegion, EmailServiceRegionConfig>();
  for (const item of regions) {
    if (normalizedMap.has(item.region)) {
      badRequest(
        "ADMIN_EMAIL_SERVICE_INVALID",
        `Duplicate email region is not allowed: ${item.region}`,
      );
    }
    normalizedMap.set(item.region, item);
  }

  return EMAIL_REGIONS.map((region) => normalizedMap.get(region) ?? {
    region,
    sender: null,
    templates: [],
  });
}

function normalizeSender(value: unknown): EmailSenderConfig | null {
  if (value == null || value === "") {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Email sender must be a JSON object.");
  }

  const source = value as Record<string, unknown>;
  const id = optionalString(source.id);
  const address = optionalString(source.address);

  if (!id && !address) {
    return null;
  }

  if (!id) {
    badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Sender ID is required.");
  }

  if (!address) {
    badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Sender address is required.");
  }

  if (!isValidSenderAddress(address)) {
    badRequest(
      "ADMIN_EMAIL_SERVICE_INVALID",
      `Sender address format is invalid: ${address}`,
    );
  }

  return {
    id,
    address,
  };
}

function normalizeTemplates(
  value: unknown,
  allowLegacyFallback: boolean,
): EmailServiceTemplateConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      badRequest(
        "ADMIN_EMAIL_SERVICE_INVALID",
        "Each email template must be a JSON object.",
      );
    }

    const source = item as Record<string, unknown>;
    const locale = normalizeEmailLocale(source.locale);
    const templateId = optionalNumber(source.templateId);
    const name = optionalString(source.name);
    const subject =
      optionalString(source.subject) ||
      (allowLegacyFallback ? defaultTemplateSubject(locale, name) : "");

    if (!locale) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Template locale is required.");
    }

    if (!name) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Template name is required.");
    }

    if (!templateId || templateId <= 0) {
      badRequest(
        "ADMIN_EMAIL_SERVICE_INVALID",
        "Template ID must be a positive number.",
      );
    }

    if (!subject) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Template subject is required.");
    }

    return {
      locale,
      templateId,
      name,
      subject,
    } satisfies EmailServiceTemplateConfig;
  });

  const templateKeySet = new Set<string>();
  for (const item of items) {
    const templateKey = `${item.name}::${item.locale}`;
    if (templateKeySet.has(templateKey)) {
      badRequest(
        "ADMIN_EMAIL_SERVICE_INVALID",
        `Duplicate template name + locale is not allowed: ${item.name} + ${item.locale}`,
      );
    }
    templateKeySet.add(templateKey);
  }

  return items;
}

function normalizeEmailLocale(value: unknown): string {
  const normalized = optionalString(value);
  if (!normalized) {
    return "";
  }

  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(normalized)) {
    badRequest(
      "ADMIN_EMAIL_SERVICE_INVALID",
      "Template locale must be a valid BCP 47 style language tag.",
    );
  }

  const segments = normalized.split("-");
  return segments
    .map((segment, index) => {
      if (index === 0) {
        return segment.toLowerCase();
      }
      if (segment.length === 2) {
        return segment.toUpperCase();
      }
      return segment;
    })
    .join("-");
}

function normalizeRegion(value: unknown): TencentSesRegion | undefined {
  const normalized = optionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === "ap-guangzhou" || normalized === "ap-hongkong") {
    return normalized;
  }

  badRequest(
    "ADMIN_EMAIL_SERVICE_INVALID",
    `Unsupported email sender region: ${normalized}`,
  );
}

function assertUniqueTemplateIds(regions: EmailServiceRegionConfig[]): void {
  const templateIds = new Set<number>();
  for (const regionConfig of regions) {
    for (const template of regionConfig.templates) {
      if (templateIds.has(template.templateId)) {
        badRequest(
          "ADMIN_EMAIL_SERVICE_INVALID",
          `Duplicate template ID is not allowed: ${template.templateId}`,
        );
      }
      templateIds.add(template.templateId);
    }
  }
}

function assertVerificationTemplateNames(
  regions: EmailServiceRegionConfig[],
): void {
  for (const regionConfig of regions) {
    if (!regionConfig.templates.length) {
      continue;
    }

    const hasVerificationTemplate = regionConfig.templates.some(
      (template) => template.name === VERIFICATION_EMAIL_TEMPLATE_NAME,
    );
    if (!hasVerificationTemplate) {
      badRequest(
        "ADMIN_EMAIL_SERVICE_INVALID",
        `Region ${regionConfig.region} must include a template named ${VERIFICATION_EMAIL_TEMPLATE_NAME}.`,
      );
    }
  }
}

function defaultTemplateSubject(locale: string, name: string): string {
  if (name) {
    return name;
  }

  return locale.toLowerCase().startsWith("zh") ? "验证码" : "Verification Code";
}

function isValidSenderAddress(value: string): boolean {
  return (
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) ||
    /^[^<>]+<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>$/.test(value)
  );
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
