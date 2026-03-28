import type { AdminPasswordDocument, PasswordDraftItem, PasswordEntry } from "./types";

export function createDefaultPasswordConfig(): PasswordDraftItem[] {
  return [];
}

export function createEmptyPasswordItem(): PasswordDraftItem {
  return {
    originalKey: "",
    key: "",
    desc: "",
    value: "",
  };
}

export function clonePasswordConfig(items: PasswordDraftItem[] | PasswordEntry[] = createDefaultPasswordConfig()): PasswordDraftItem[] {
  return Array.isArray(items)
    ? items.map((item) => ({
        originalKey: String(("originalKey" in item ? item.originalKey : item.key) ?? ""),
        key: String(item?.key ?? ""),
        desc: String(item?.desc ?? ""),
        value: String(item?.value ?? ""),
        valueMd5: item?.valueMd5 ? String(item.valueMd5) : "",
        updatedAt: item?.updatedAt ? String(item.updatedAt) : undefined,
      }))
    : [];
}

export function normalizePasswordDocument(document: AdminPasswordDocument | null) {
  return document;
}

export function serializePasswordDraft(draft: PasswordDraftItem[]) {
  const items = [];

  for (const [index, item] of draft.entries()) {
    const key = String(item?.key ?? "").trim();
    const desc = String(item?.desc ?? "").trim();
    const value = typeof item?.value === "string" ? item.value : "";

    if (!key && !desc && !value) {
      continue;
    }

    if (!key || !value) {
      throw new Error(`请完整填写第 ${index + 1} 个密码项。`);
    }

    items.push({ key, desc, value });
  }

  return items;
}

export function serializePasswordItem(item: PasswordDraftItem, index: number) {
  const key = String(item.key ?? "").trim();
  const desc = String(item.desc ?? "").trim();
  const value = typeof item.value === "string" ? item.value : "";
  const originalKey = String(item.originalKey ?? "").trim();

  if (!key || !value) {
    throw new Error(`请完整填写第 ${index + 1} 个密码项。`);
  }

  return {
    originalKey: originalKey || undefined,
    key,
    desc,
    value,
  };
}

export function serializePasswordDraftForPreview(draft: PasswordDraftItem[]) {
  try {
    return { items: serializePasswordDraft(draft) };
  } catch {
    return { items: Array.isArray(draft) ? draft : [] };
  }
}
