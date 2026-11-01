/** One campaign policy shared by Admin validation, public display and admission. */
export interface AiNovelAutoFreeConfig {
  enabled: boolean;
  startsAt?: string;
  endsAt?: string;
}

export function parseAiNovelAutoFreeConfig(value: unknown): AiNovelAutoFreeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Auto 免费配置必须为对象。");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some(key => !["enabled", "startsAt", "endsAt"].includes(key)) || typeof source.enabled !== "boolean") {
    throw new Error("Auto 免费配置只支持 enabled、startsAt、endsAt，enabled 必须为布尔值。");
  }
  const date = (key: string): string | undefined => {
    const raw = source[key];
    if (raw === undefined) return undefined;
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(Date.parse(raw))) {
      throw new Error(`${key} 必须为带时区的 ISO 日期时间。`);
    }
    const zone = raw.match(/([+-])(\d{2}):(\d{2})$/);
    const offset = zone ? (zone[1] === "+" ? 1 : -1) * (Number(zone[2]) * 60 + Number(zone[3])) * 60_000 : 0;
    if (new Date(Date.parse(raw) + offset).toISOString().slice(0, 19) !== raw.slice(0, 19)) {
      throw new Error(`${key} 不是有效的日期时间。`);
    }
    return new Date(raw).toISOString();
  };
  const startsAt = date("startsAt"), endsAt = date("endsAt");
  if (startsAt && endsAt && startsAt >= endsAt) throw new Error("免费结束时间必须晚于开始时间。");
  return { enabled: source.enabled, ...(startsAt ? { startsAt } : {}), ...(endsAt ? { endsAt } : {}) };
}

export function aiNovelAutoFreeActive(config: AiNovelAutoFreeConfig | undefined, now = new Date()): boolean {
  return config?.enabled === true && (!config.startsAt || now.getTime() >= Date.parse(config.startsAt)) &&
    (!config.endsAt || now.getTime() < Date.parse(config.endsAt));
}

export function aiNovelAutoFreeSnapshot(config: AiNovelAutoFreeConfig | undefined, now = new Date()) {
  return { ...(config ?? { enabled: false }), active: aiNovelAutoFreeActive(config, now), serverTime: now.toISOString() };
}
