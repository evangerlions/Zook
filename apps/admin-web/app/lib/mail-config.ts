import type {
  EmailServiceConfig,
  AdminEmailServiceDocument,
  MailConfigDraft,
  MailRegionDraft,
  MailTemplateDraft,
  MailTestDraft,
} from "./types";

const DEFAULT_CHINESE_LOCALE = "zh-CN";

export const MAIL_TEMPLATE_LOCALE_OPTIONS = [
  { value: "en-US", label: "英语 (en-US)" },
  { value: "zh-CN", label: "中文（简体）(zh-CN)" },
  { value: "zh-TW", label: "中文（繁体）(zh-TW)" },
  { value: "ja-JP", label: "日语 (ja-JP)" },
  { value: "es-ES", label: "西班牙语 (es-ES)" },
  { value: "pt-BR", label: "葡萄牙语 (pt-BR)" },
  { value: "ko-KR", label: "韩语 (ko-KR)" },
  { value: "de-DE", label: "德语 (de-DE)" },
  { value: "fr-FR", label: "法语 (fr-FR)" },
  { value: "hi-IN", label: "印地语 (hi-IN)" },
  { value: "id-ID", label: "印尼语 (id-ID)" },
  { value: "it-IT", label: "意大利语 (it-IT)" },
  { value: "tr-TR", label: "土耳其语 (tr-TR)" },
  { value: "vi-VN", label: "越南语 (vi-VN)" },
  { value: "th-TH", label: "泰语 (th-TH)" },
  { value: "pl-PL", label: "波兰语 (pl-PL)" },
  { value: "nl-NL", label: "荷兰语 (nl-NL)" },
  { value: "sv-SE", label: "瑞典语 (sv-SE)" },
  { value: "bn-BD", label: "孟加拉语 (bn-BD)" },
  { value: "sw-KE", label: "斯瓦希里语 (sw-KE)" },
];

export const MAIL_SENDER_REGION_OPTIONS = [
  { value: "ap-guangzhou", label: "中国大陆 / 广州" },
  { value: "ap-hongkong", label: "海外 / 中国香港" },
] as const;
const REQUIRED_VERIFICATION_TEMPLATE_NAME = "verify-code";

export function renderMailRegionLabel(region: string) {
  return MAIL_SENDER_REGION_OPTIONS.find((item) => item.value === region)?.label ?? region;
}

export function createEmptyMailSender() {
  return {
    id: "",
    address: "",
  };
}

export function createEmptyMailTemplate(): MailTemplateDraft {
  return {
    locale: DEFAULT_CHINESE_LOCALE,
    templateId: "",
    name: "",
    subject: "",
  };
}

export function createEmptyMailRegion(region: MailRegionDraft["region"]): MailRegionDraft {
  return {
    region,
    sender: null,
    templates: [],
  };
}

export function createDefaultMailConfig(): MailConfigDraft {
  return {
    enabled: false,
    regions: MAIL_SENDER_REGION_OPTIONS.map((option) => createEmptyMailRegion(option.value)),
  };
}

export function createDefaultMailTestDraft(): MailTestDraft {
  return {
    recipientEmail: "",
    region: MAIL_SENDER_REGION_OPTIONS[0].value,
    templateId: "",
    appName: "Zook",
    code: "123456",
    expireMinutes: 10,
  };
}

export function cloneMailConfig(config: MailConfigDraft | EmailServiceConfig = createDefaultMailConfig()): MailConfigDraft {
  const sourceRegions = Array.isArray(config?.regions) ? config.regions : [];
  return {
    enabled: Boolean(config?.enabled),
    regions: MAIL_SENDER_REGION_OPTIONS.map((option) => {
      const source = sourceRegions.find((item) => item?.region === option.value);
      return {
        region: option.value,
        sender: source?.sender
          ? {
              id: String(source.sender.id ?? ""),
              address: String(source.sender.address ?? ""),
            }
          : null,
        templates: Array.isArray(source?.templates)
          ? source.templates.map((item) => ({
              locale: String(item?.locale ?? DEFAULT_CHINESE_LOCALE),
              templateId: item?.templateId == null ? "" : String(item.templateId),
              name: String(item?.name ?? ""),
              subject: String(item?.subject ?? ""),
            }))
          : [],
      };
    }),
  };
}

export function normalizeMailDocument(document: AdminEmailServiceDocument | null) {
  return document;
}

export function formatMailConfigJson(config: MailConfigDraft | EmailServiceConfig = createDefaultMailConfig()) {
  return JSON.stringify(serializeMailDraftForPreview(cloneMailConfig(config)), null, 2);
}

export function getMailDraftValidationError(draft: MailConfigDraft) {
  try {
    serializeMailDraft(draft);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "邮件配置校验失败。";
  }
}

export function parseMailConfigText(rawText: string) {
  const parsed = parseMailJsonObject(rawText);
  const config = normalizeMailConfigInput(parsed, "raw");

  return {
    config,
    draft: cloneMailConfig(config),
    normalizedText: JSON.stringify(config, null, 2),
  };
}

export function getMailRegionConfig(config: MailConfigDraft | undefined, region: string): MailRegionDraft {
  const normalizedConfig = cloneMailConfig(config);
  return normalizedConfig.regions.find((item) => item.region === region)
    ?? normalizedConfig.regions[0]
    ?? createEmptyMailRegion(MAIL_SENDER_REGION_OPTIONS[0].value);
}

export function normalizeMailTestDraft(draft: MailTestDraft | null, config: MailConfigDraft): MailTestDraft {
  const preferredRegion = String(draft?.region ?? "").trim();
  const region = MAIL_SENDER_REGION_OPTIONS.some((item) => item.value === preferredRegion)
    ? preferredRegion as MailTestDraft["region"]
    : MAIL_SENDER_REGION_OPTIONS[0].value;
  const regionConfig = getMailRegionConfig(config, region);
  const templates = Array.isArray(regionConfig.templates) ? regionConfig.templates : [];
  const preferredTemplateId = String(draft?.templateId ?? "").trim();
  const hasTemplate = templates.some((item) => String(item.templateId) === preferredTemplateId);

  return {
    recipientEmail: String(draft?.recipientEmail ?? "").trim(),
    region,
    templateId: hasTemplate ? preferredTemplateId : String(templates[0]?.templateId ?? ""),
    appName: String(draft?.appName ?? "Zook"),
    code: String(draft?.code ?? "123456"),
    expireMinutes: String(draft?.expireMinutes ?? "").trim() ? Number(draft?.expireMinutes) : 10,
  };
}

export function serializeMailDraft(draft: MailConfigDraft) {
  return normalizeMailConfigInput(
    {
      enabled: Boolean(draft.enabled),
      regions: draft.regions.map((regionConfig, regionIndex) => ({
        region: String(regionConfig?.region ?? MAIL_SENDER_REGION_OPTIONS[regionIndex]?.value ?? "").trim(),
        sender: regionConfig?.sender
          ? {
              id: String(regionConfig.sender.id ?? "").trim(),
              address: String(regionConfig.sender.address ?? "").trim(),
            }
          : null,
        templates: regionConfig.templates.map((item) => ({
          locale: String(item?.locale ?? "").trim(),
          templateId: String(item?.templateId ?? "").trim(),
          name: String(item?.name ?? "").trim(),
          subject: String(item?.subject ?? "").trim(),
        })),
      })),
    },
    "form",
  );
}

export function serializeMailTestDraft(draft: MailTestDraft) {
  const recipientEmail = String(draft.recipientEmail ?? "").trim();
  const region = String(draft.region ?? "").trim();
  const templateIdText = String(draft.templateId ?? "").trim();
  const appName = String(draft.appName ?? "").trim();
  const code = String(draft.code ?? "").trim();
  const expireMinutesText = String(draft.expireMinutes ?? "").trim();

  if (!recipientEmail) {
    throw new Error("请填写测试邮件的收件邮箱。");
  }

  if (!isValidSenderAddress(recipientEmail) || recipientEmail.includes("<")) {
    throw new Error("测试邮件的收件邮箱格式不正确。");
  }

  if (!region) {
    throw new Error("请选择发信 Region。");
  }

  if (!templateIdText) {
    throw new Error("请选择模板 ID。");
  }

  const templateId = Number(templateIdText);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    throw new Error("模板 ID 必须是正整数。");
  }

  if (!appName) {
    throw new Error("请填写 App 名称。");
  }

  if (!code) {
    throw new Error("请填写验证码。");
  }

  const expireMinutes = Number(expireMinutesText);
  if (!Number.isInteger(expireMinutes) || expireMinutes <= 0 || expireMinutes > 120) {
    throw new Error("过期分钟必须是 1 到 120 之间的整数。");
  }

  return {
    recipientEmail,
    region: region as MailTestDraft["region"],
    templateId,
    appName,
    code,
    expireMinutes,
  };
}

export function serializeMailDraftForPreview(draft: MailConfigDraft) {
  try {
    return serializeMailDraft(draft);
  } catch {
    return {
      enabled: Boolean(draft.enabled),
      regions: draft.regions.map((region) => ({
        region: region.region,
        sender: region.sender,
        templates: region.templates,
      })),
    };
  }
}

export function safeSerializeMailDraft(draft: MailConfigDraft) {
  try {
    return serializeMailDraft(draft);
  } catch {
    return {
      enabled: Boolean(draft.enabled),
      regions: draft.regions.map((region) => ({
        region: region.region,
        sender: region.sender,
        templates: region.templates,
      })),
    };
  }
}

function isValidSenderAddress(value: string) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)
    || /^[^<>]+<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>$/.test(value);
}

function normalizeMailConfigInput(input: unknown, mode: "form" | "raw"): EmailServiceConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("邮件配置根节点必须是 JSON object。");
  }

  const source = input as Record<string, unknown>;
  const config: EmailServiceConfig = {
    enabled: Boolean(source.enabled),
    regions: normalizeRegions(source.regions, mode),
  };

  assertUniqueTemplateIds(config.regions);

  if (!config.enabled) {
    return config;
  }

  assertVerificationTemplateNames(config.regions);

  if (!config.regions.some((item) => item.sender && item.templates.length)) {
    throw new Error("至少需要为一个 Region 配置发件地址和模板。");
  }

  return config;
}

function normalizeRegions(value: unknown, mode: "form" | "raw"): EmailServiceConfig["regions"] {
  if (!Array.isArray(value)) {
    return MAIL_SENDER_REGION_OPTIONS.map((option) => ({
      region: option.value,
      sender: null,
      templates: [],
    }));
  }

  const regions = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`第 ${index + 1} 个 Region 必须是 JSON object。`);
    }

    const source = item as Record<string, unknown>;
    const region = normalizeRegion(source.region);

    return {
      region,
      sender: normalizeSender(source.sender, region),
      templates: normalizeTemplates(source.templates, region, mode),
    };
  });

  const normalizedMap = new Map<EmailServiceConfig["regions"][number]["region"], EmailServiceConfig["regions"][number]>();
  for (const item of regions) {
    if (normalizedMap.has(item.region)) {
      throw new Error(`Region 不允许重复：${item.region}`);
    }
    normalizedMap.set(item.region, item);
  }

  return MAIL_SENDER_REGION_OPTIONS.map((option) => normalizedMap.get(option.value) ?? {
    region: option.value,
    sender: null,
    templates: [],
  });
}

function normalizeRegion(value: unknown): EmailServiceConfig["regions"][number]["region"] {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new Error("Region 不能为空。");
  }

  if (normalized !== "ap-guangzhou" && normalized !== "ap-hongkong") {
    throw new Error(`不支持的 Region：${normalized}`);
  }

  return normalized;
}

function normalizeSender(value: unknown, region: EmailServiceConfig["regions"][number]["region"]) {
  if (value == null || value === "") {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${renderMailRegionLabel(region)} 的发件地址必须是 JSON object。`);
  }

  const source = value as Record<string, unknown>;
  const id = optionalString(source.id);
  const address = optionalString(source.address);

  if (!id && !address) {
    return null;
  }

  if (!id || !address) {
    throw new Error(`请完整填写 ${renderMailRegionLabel(region)} 的发件地址。`);
  }

  if (!isValidSenderAddress(address)) {
    throw new Error(`${renderMailRegionLabel(region)} 的发件地址格式不正确。`);
  }

  return {
    id,
    address,
  };
}

function normalizeTemplates(
  value: unknown,
  region: EmailServiceConfig["regions"][number]["region"],
  mode: "form" | "raw",
) {
  if (!Array.isArray(value)) {
    return [];
  }

  const templates = value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${renderMailRegionLabel(region)} 的第 ${index + 1} 个模板必须是 JSON object。`);
    }

    const source = item as Record<string, unknown>;
    const rawLocale = optionalString(source.locale);
    const rawName = optionalString(source.name);
    const rawSubject = optionalString(source.subject);

    if (mode === "form" && !rawLocale && !rawName && !rawSubject && isEmptyTemplateId(source.templateId)) {
      return [];
    }

    const locale = normalizeLocale(source.locale, region, index + 1);
    const templateId = normalizeTemplateId(source.templateId, region, index + 1, mode);
    const name = requireTrimmedString(
      source.name,
      `${renderMailRegionLabel(region)} 的第 ${index + 1} 个模板必须填写名称。`,
    );
    const subject = requireTrimmedString(
      source.subject,
      `${renderMailRegionLabel(region)} 的第 ${index + 1} 个模板必须填写主题。`,
    );

    return [{
      locale,
      templateId,
      name,
      subject,
    }];
  });

  const templateKeySet = new Set<string>();
  for (const item of templates) {
    const templateKey = `${item.name}::${item.locale}`;
    if (templateKeySet.has(templateKey)) {
      throw new Error(`${renderMailRegionLabel(region)} 的模板名称 + locale 不允许重复：${item.name} / ${item.locale}`);
    }
    templateKeySet.add(templateKey);
  }

  return templates;
}

function normalizeLocale(
  value: unknown,
  region: EmailServiceConfig["regions"][number]["region"],
  templateIndex: number,
) {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new Error(`${renderMailRegionLabel(region)} 的第 ${templateIndex} 个模板必须填写 locale。`);
  }

  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(normalized)) {
    throw new Error(`${renderMailRegionLabel(region)} 的第 ${templateIndex} 个模板 locale 格式不正确。`);
  }

  return normalized
    .split("-")
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

function normalizeTemplateId(
  value: unknown,
  region: EmailServiceConfig["regions"][number]["region"],
  templateIndex: number,
  mode: "form" | "raw",
) {
  const label = `${renderMailRegionLabel(region)} 的第 ${templateIndex} 个模板 ID`;

  if (mode === "raw") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${label} 必须是 number。`);
    }

    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${label} 必须是正整数。`);
    }

    return value;
  }

  const normalized = Number(optionalString(value));
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${label} 必须是正整数。`);
  }

  return normalized;
}

function assertUniqueTemplateIds(regions: EmailServiceConfig["regions"]) {
  const templateIds = new Set<number>();
  for (const regionConfig of regions) {
    for (const template of regionConfig.templates) {
      if (templateIds.has(template.templateId)) {
        throw new Error(`模板 ID 不允许重复：${template.templateId}`);
      }
      templateIds.add(template.templateId);
    }
  }
}

function assertVerificationTemplateNames(regions: EmailServiceConfig["regions"]) {
  for (const regionConfig of regions) {
    if (!regionConfig.templates.length) {
      continue;
    }

    if (!regionConfig.templates.some((item) => item.name === REQUIRED_VERIFICATION_TEMPLATE_NAME)) {
      throw new Error(
        `${renderMailRegionLabel(regionConfig.region)} 的模板列表里必须至少包含一个名称为 ${REQUIRED_VERIFICATION_TEMPLATE_NAME} 的模板。`,
      );
    }
  }
}

function requireTrimmedString(value: unknown, message: string) {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isEmptyTemplateId(value: unknown) {
  return typeof value !== "string" || !value.trim();
}

function parseMailJsonObject(rawText: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(formatJsonParseError(rawText, error));
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("邮件配置根节点必须是 JSON object。");
  }

  return parsed as Record<string, unknown>;
}

function formatJsonParseError(rawText: string, error: unknown) {
  const message = error instanceof Error ? error.message : "请输入合法的 JSON。";
  const positionMatch = /position\s+(\d+)/i.exec(message);
  if (!positionMatch) {
    return "请输入合法的 JSON。";
  }

  const position = Number(positionMatch[1]);
  if (!Number.isInteger(position) || position < 0) {
    return "请输入合法的 JSON。";
  }

  const { line, column } = getJsonLineColumn(rawText, position);
  return `JSON 语法错误：第 ${line} 行，第 ${column} 列。`;
}

function getJsonLineColumn(text: string, position: number) {
  const normalized = text.slice(0, position);
  const lines = normalized.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1]!.length + 1,
  };
}
