import { createHash } from "node:crypto";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import { maskSensitiveString, matchesMaskedSensitiveString } from "../shared/utils.ts";
import type { AdminAppSummary, AdminPasswordDocument, PasswordEntry } from "../shared/types.ts";
import { PasswordManager } from "./password-manager.ts";

const COMMON_APP_ID = "common";
const PASSWORD_CONFIG_KEY = "common.passwords";
const PASSWORD_SCOPE = "common-passwords";
const COMMON_APP_SUMMARY: AdminAppSummary = {
  appId: COMMON_APP_ID,
  appCode: COMMON_APP_ID,
  appName: "服务端配置",
  status: "ACTIVE",
  canDelete: false,
};
const PASSWORD_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export class CommonPasswordConfigService {
  constructor(private readonly passwordManager: PasswordManager) {}

  async getDocument(): Promise<AdminPasswordDocument> {
    const items = await this.passwordManager.list(PASSWORD_SCOPE);
    return this.toDocument(items);
  }

  async updateConfig(input: unknown): Promise<AdminPasswordDocument> {
    const existingItems = await this.passwordManager.list(PASSWORD_SCOPE);
    const normalized = this.validateInput(input, existingItems);
    await this.passwordManager.replace(PASSWORD_SCOPE, normalized);
    return this.getDocument();
  }

  async upsertItem(input: unknown): Promise<AdminPasswordDocument> {
    const existingItems = await this.passwordManager.list(PASSWORD_SCOPE);
    const existingMap = new Map(existingItems.map((item) => [item.key, item]));

    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("ADMIN_PASSWORD_INVALID", "Password item must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    const originalKey = this.optionalString(source.originalKey);
    const requestedKey = this.optionalString(source.key);
    if (originalKey && requestedKey && originalKey !== requestedKey) {
      badRequest("ADMIN_PASSWORD_INVALID", "Password key cannot be changed once created.");
    }

    const normalized = this.normalizeItem(source, 0, existingMap);

    await this.passwordManager.set(PASSWORD_SCOPE, normalized.key, normalized.desc, normalized.value);

    return this.getDocument();
  }

  async deleteItem(key: string): Promise<AdminPasswordDocument> {
    const normalizedKey = this.optionalString(key);
    if (!normalizedKey) {
      badRequest("ADMIN_PASSWORD_INVALID", "Password key is required.");
    }

    await this.passwordManager.delete(PASSWORD_SCOPE, normalizedKey);
    return this.getDocument();
  }

  async set(key: string, desc: string, value: string): Promise<void> {
    await this.passwordManager.set(PASSWORD_SCOPE, key, desc, value);
  }

  async getValue(key: string): Promise<string | undefined> {
    return this.passwordManager.getValue(PASSWORD_SCOPE, key);
  }

  private toDocument(items: PasswordEntry[]): AdminPasswordDocument {
    const maskedItems = items.map((item) => ({
      ...item,
      value: maskSensitiveString(item.value),
      valueMd5: createHash("md5").update(item.value).digest("hex"),
    }));
    const updatedAt = maskedItems
      .map((item) => item.updatedAt)
      .filter(Boolean)
      .sort()
      .at(-1);

    return {
      app: COMMON_APP_SUMMARY,
      configKey: PASSWORD_CONFIG_KEY,
      items: maskedItems,
      updatedAt,
    };
  }

  private validateInput(input: unknown, existingItems: PasswordEntry[]): PasswordEntry[] {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("ADMIN_PASSWORD_INVALID", "Password config must be a JSON object.");
    }

    const items = (input as Record<string, unknown>).items;
    if (!Array.isArray(items)) {
      badRequest("ADMIN_PASSWORD_INVALID", "Password items must be an array.");
    }

    const existingMap = new Map(existingItems.map((item) => [item.key, item]));
    const normalized = items.map((item, index) => this.normalizeItem(item, index, existingMap));
    const keySet = new Set<string>();
    for (const item of normalized) {
      if (keySet.has(item.key)) {
        badRequest("ADMIN_PASSWORD_INVALID", `Duplicate password key is not allowed: ${item.key}`);
      }
      keySet.add(item.key);
    }
    return normalized;
  }

  private normalizeItem(
    item: unknown,
    index: number,
    existingMap: Map<string, PasswordEntry>,
  ): PasswordEntry {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      badRequest("ADMIN_PASSWORD_INVALID", `Password item #${index + 1} must be a JSON object.`);
    }

    const source = item as Record<string, unknown>;
    const originalKey = this.optionalString(source.originalKey);
    const key = this.optionalString(source.key);
    const desc = this.optionalString(source.desc);
    const existingLookupKey = originalKey || key;
    const existing = existingLookupKey ? existingMap.get(existingLookupKey) : undefined;
    const value = this.resolveValue(source.value, existing?.value);

    if (!key) {
      badRequest("ADMIN_PASSWORD_INVALID", `Password item #${index + 1} key is required.`);
    }

    if (!PASSWORD_KEY_PATTERN.test(key)) {
      badRequest("ADMIN_PASSWORD_INVALID", `Password key is invalid: ${key}`);
    }

    if (!value) {
      badRequest("ADMIN_PASSWORD_INVALID", `Password item #${index + 1} value is required.`);
    }

    return {
      key,
      desc,
      value,
      updatedAt: existing?.updatedAt,
    };
  }

  private resolveValue(value: unknown, existingValue?: string): string {
    if (typeof value !== "string") {
      return "";
    }

    if (!existingValue) {
      return value;
    }

    if (matchesMaskedSensitiveString(value, existingValue)) {
      return existingValue;
    }

    return value;
  }

  private optionalString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }
}
