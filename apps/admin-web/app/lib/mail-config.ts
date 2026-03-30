import type {
  EmailServiceConfig,
  AdminEmailServiceDocument,
  MailConfigDraft,
  MailRegionDraft,
  MailTemplateDraft,
  MailTestDraft,
} from "./types";
import { DEFAULT_CHINESE_LOCALE, SUPPORTED_LOCALE_OPTIONS } from "./locale-options";

export const MAIL_TEMPLATE_LOCALE_OPTIONS = SUPPORTED_LOCALE_OPTIONS;

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
  const enabled = Boolean(draft.enabled);
  const regions = draft.regions.map((regionConfig, regionIndex) => {
      const region = String(regionConfig?.region ?? MAIL_SENDER_REGION_OPTIONS[regionIndex]?.value ?? "").trim();
      const senderId = String(regionConfig?.sender?.id ?? "").trim();
      const senderAddress = String(regionConfig?.sender?.address ?? "").trim();

      let sender = null;
      if (senderId || senderAddress) {
        if (!senderId || !senderAddress) {
          throw new Error(`请完整填写 ${renderMailRegionLabel(region)} 的发件地址。`);
        }
        if (!isValidSenderAddress(senderAddress)) {
          throw new Error(`${renderMailRegionLabel(region)} 的发件地址格式不正确。`);
        }
        sender = {
          id: senderId,
          address: senderAddress,
        };
      }

      const templates = [];
      for (const [templateIndex, item] of regionConfig.templates.entries()) {
        const locale = String(item?.locale ?? "").trim();
        const templateIdText = String(item?.templateId ?? "").trim();
        const name = String(item?.name ?? "").trim();
        const subject = String(item?.subject ?? "").trim();
        if (!templateIdText && !name && !subject) {
          continue;
        }
        if (!locale || !templateIdText || !name || !subject) {
          throw new Error(`请完整填写 ${renderMailRegionLabel(region)} 的第 ${templateIndex + 1} 个模板。`);
        }

        const templateId = Number(templateIdText);
        if (!Number.isInteger(templateId) || templateId <= 0) {
          throw new Error(`${renderMailRegionLabel(region)} 的第 ${templateIndex + 1} 个模板 ID 必须是正整数。`);
        }

        templates.push({
          locale,
          templateId,
          name,
          subject,
        });
      }

      if (
        enabled
        && templates.length > 0
        && !templates.some((item) => item.name === REQUIRED_VERIFICATION_TEMPLATE_NAME)
      ) {
        throw new Error(
          `${renderMailRegionLabel(region)} 的模板列表里必须至少包含一个名称为 ${REQUIRED_VERIFICATION_TEMPLATE_NAME} 的模板。`,
        );
      }

      return {
        region,
        sender,
        templates,
      };
    });

  if (enabled && !regions.some((item) => item.sender && item.templates.length)) {
    throw new Error("至少需要为一个 Region 配置发件地址和模板。");
  }

  return {
    enabled,
    regions,
  };
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
