export interface SupportedLocaleOption {
  value: string;
  label: string;
}

export const SUPPORTED_LOCALE_OPTIONS: SupportedLocaleOption[] = [
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

export const SUPPORTED_LOCALE_VALUE_SET = new Set(SUPPORTED_LOCALE_OPTIONS.map((item) => item.value));
export const DEFAULT_SUPPORTED_LOCALE = "en-US";
export const DEFAULT_CHINESE_LOCALE = "zh-CN";
