import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import { ApplicationError, badRequest, conflict, forbidden, unauthorized } from "../shared/errors.ts";
import type {
  AdminAppSummary,
  AdminTestAccountDocument,
  AdminTestAccountItem,
  AdminTestAccountRevealDocument,
  TestAccountRecord,
} from "../shared/types.ts";
import { randomId, randomNumericCode, sha256, timingSafeStringCompare } from "../shared/utils.ts";
import { VersionedAppConfigService } from "./versioned-app-config.service.ts";

const COMMON_APP_ID = "common";
export const TEST_ACCOUNT_CONFIG_KEY = "common.test_accounts";
export const TEST_ACCOUNT_CODE_REVEAL_OPERATION = "test_account.code.reveal";
const TEST_ACCOUNT_FAILURE_SCOPE = "auth.test-account-code-failures";
const TEST_ACCOUNT_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const TEST_ACCOUNT_MAX_FAILED_ATTEMPTS = 10;
const TEST_ACCOUNT_LOCK_DURATION_MS = 15 * 60 * 1000;

interface TestAccountCodeFailureState {
  count: number;
  windowStartedAt: number;
  lockedUntil?: number;
}

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

export class CommonTestAccountService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly kvManager: KVManager,
    private readonly appConfigService: VersionedAppConfigService,
    private readonly codeGenerator: () => string = () => randomNumericCode(6),
    private readonly afterMutation: () => Promise<void> = async () => {},
  ) {}

  async getDocument(): Promise<AdminTestAccountDocument> {
    const { records, updatedAt } = await this.loadState();
    return this.toDocument(records, updatedAt);
  }

  async create(input: unknown, now = new Date()): Promise<AdminTestAccountDocument> {
    const { records } = await this.loadState();
    const normalized = this.normalizeMutableInput(input);
    await this.assertAppExists(normalized.appId);
    this.assertUnique(records, normalized.appId, normalized.phone);
    const timestamp = now.toISOString();
    records.push({
      id: randomId("test_account"),
      ...normalized,
      verifyCode: this.createVerifyCode(),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return this.saveAndDocument(records, "test-account-created");
  }

  async update(id: string, input: unknown, now = new Date()): Promise<AdminTestAccountDocument> {
    const { records } = await this.loadState();
    const index = records.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new ApplicationError(404, "TEST_ACCOUNT_NOT_FOUND", "Test account was not found.");
    }
    const normalized = this.normalizeMutableInput(input);
    await this.assertAppExists(normalized.appId);
    this.assertUnique(records, normalized.appId, normalized.phone, id);
    records[index] = {
      ...records[index],
      ...normalized,
      updatedAt: now.toISOString(),
    };
    return this.saveAndDocument(records, "test-account-updated");
  }

  async delete(id: string): Promise<AdminTestAccountDocument> {
    const { records } = await this.loadState();
    const nextRecords = records.filter((item) => item.id !== id);
    if (nextRecords.length === records.length) {
      throw new ApplicationError(404, "TEST_ACCOUNT_NOT_FOUND", "Test account was not found.");
    }
    return this.saveAndDocument(nextRecords, "test-account-deleted");
  }

  async resetCode(id: string, now = new Date()): Promise<AdminTestAccountDocument> {
    const { records } = await this.loadState();
    const record = records.find((item) => item.id === id);
    if (!record) {
      throw new ApplicationError(404, "TEST_ACCOUNT_NOT_FOUND", "Test account was not found.");
    }
    record.verifyCode = this.createVerifyCode();
    record.updatedAt = now.toISOString();
    return this.saveAndDocument(records, "test-account-code-reset");
  }

  async revealCode(id: string, now = new Date()): Promise<AdminTestAccountRevealDocument> {
    const { records, updatedAt } = await this.loadState();
    const record = records.find((item) => item.id === id);
    if (!record) {
      throw new ApplicationError(404, "TEST_ACCOUNT_NOT_FOUND", "Test account was not found.");
    }
    return {
      app: COMMON_APP_SUMMARY,
      configKey: TEST_ACCOUNT_CONFIG_KEY,
      item: this.toAdminItem(record),
      verifyCode: record.verifyCode,
      revealedAt: now.toISOString(),
    };
  }

  async verifyEnabledCode(command: {
    appId: string;
    phone: string;
    code: string;
    now?: Date;
  }): Promise<boolean> {
    const record = await this.findEnabled(command.appId, command.phone);
    if (!record) {
      return false;
    }
    const now = command.now ?? new Date();
    const failureKey = this.buildFailureKey(command.appId, command.phone);
    await this.assertCodeNotLocked(failureKey, now);
    if (timingSafeStringCompare(record.verifyCode, command.code.trim())) {
      await this.clearFailureState(failureKey);
      return true;
    }
    await this.registerFailure(failureKey, now);
    unauthorized(
      "AUTH_VERIFICATION_CODE_INVALID",
      "SMS verification code is invalid or expired.",
    );
  }

  async hasEnabledAccount(appId: string, phone: string): Promise<boolean> {
    return Boolean(await this.findEnabled(appId, phone));
  }

  normalizePhone(phone: string, phoneNa?: string): { phone: string; phoneNa: string } {
    const rawPhone = phone.trim();
    const rawPhoneNa = phoneNa?.trim() || "+86";
    const normalizedPhoneNa = rawPhoneNa.startsWith("+") ? rawPhoneNa : `+${rawPhoneNa}`;
    const digitsOnly = rawPhone.replace(/[^\d]/g, "");
    if (!/^\+\d{1,4}$/.test(normalizedPhoneNa)) {
      badRequest("REQ_INVALID_BODY", "phoneNa must be a valid country calling code.");
    }
    if (!/^\d{4,20}$/.test(digitsOnly)) {
      badRequest("REQ_INVALID_BODY", "phone must be a valid phone number.");
    }
    if (normalizedPhoneNa === "+86" && !/^1\d{10}$/.test(digitsOnly)) {
      badRequest("REQ_INVALID_BODY", "phone must be a valid mainland China mobile number.");
    }
    return {
      phoneNa: normalizedPhoneNa,
      phone: `${normalizedPhoneNa}${digitsOnly}`,
    };
  }

  private async findEnabled(appId: string, phone: string): Promise<TestAccountRecord | undefined> {
    const { records } = await this.loadState();
    return records.find((item) => item.enabled && item.appId === appId && item.phone === phone);
  }

  private async assertAppExists(appId: string): Promise<void> {
    if (!(await this.database.findApp(appId))) {
      throw new ApplicationError(404, "APP_NOT_FOUND", "App was not found.");
    }
  }

  private normalizeMutableInput(input: unknown): Omit<TestAccountRecord, "id" | "verifyCode" | "createdAt" | "updatedAt"> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("REQ_INVALID_BODY", "Test account payload must be a JSON object.");
    }
    const source = input as Record<string, unknown>;
    const appId = this.requireString(source.appId, "appId");
    const { phone, phoneNa } = this.normalizePhone(
      this.requireString(source.phone, "phone"),
      this.optionalString(source.phoneNa),
    );
    return {
      appId,
      phoneNa,
      phone,
      label: this.optionalString(source.label),
      enabled: source.enabled !== false,
    };
  }

  private assertUnique(
    records: TestAccountRecord[],
    appId: string,
    phone: string,
    exceptId?: string,
  ): void {
    if (records.some((item) => item.id !== exceptId && item.appId === appId && item.phone === phone)) {
      conflict("TEST_ACCOUNT_DUPLICATE", "A test account already exists for this app and phone.");
    }
  }

  private async saveAndDocument(records: TestAccountRecord[], desc: string): Promise<AdminTestAccountDocument> {
    const saved = await this.appConfigService.setValue(
      COMMON_APP_ID,
      TEST_ACCOUNT_CONFIG_KEY,
      JSON.stringify({ items: records }, null, 2),
      desc,
    );
    await this.afterMutation();
    return this.toDocument(records, saved.createdAt);
  }

  private async assertCodeNotLocked(key: string, now: Date): Promise<void> {
    const state = await this.getFailureState(key);
    if (!state?.lockedUntil) {
      return;
    }
    if (state.lockedUntil > now.getTime()) {
      forbidden(
        "AUTH_LOGIN_TEMPORARILY_LOCKED",
        "Too many failed logins. Please retry after the lock window.",
      );
    }
    await this.clearFailureState(key);
  }

  private async registerFailure(key: string, now: Date): Promise<void> {
    const previous = await this.getFailureState(key);
    const currentTime = now.getTime();
    if (!previous || currentTime - previous.windowStartedAt > TEST_ACCOUNT_FAILURE_WINDOW_MS) {
      await this.setFailureState(key, {
        count: 1,
        windowStartedAt: currentTime,
      });
      return;
    }
    const nextState: TestAccountCodeFailureState = {
      count: previous.count + 1,
      windowStartedAt: previous.windowStartedAt,
      lockedUntil: previous.lockedUntil,
    };
    if (nextState.count >= TEST_ACCOUNT_MAX_FAILED_ATTEMPTS) {
      nextState.count = 0;
      nextState.windowStartedAt = currentTime;
      nextState.lockedUntil = currentTime + TEST_ACCOUNT_LOCK_DURATION_MS;
    }
    await this.setFailureState(key, nextState);
  }

  private async getFailureState(key: string): Promise<TestAccountCodeFailureState | undefined> {
    return await this.kvManager.getJson<TestAccountCodeFailureState>(
      TEST_ACCOUNT_FAILURE_SCOPE,
      key,
    );
  }

  private async setFailureState(key: string, state: TestAccountCodeFailureState): Promise<void> {
    await this.kvManager.setJson(TEST_ACCOUNT_FAILURE_SCOPE, key, state);
  }

  private async clearFailureState(key: string): Promise<void> {
    await this.kvManager.delete(TEST_ACCOUNT_FAILURE_SCOPE, key);
  }

  private buildFailureKey(appId: string, phone: string): string {
    return sha256(`${appId.trim()}:${phone.trim()}`);
  }

  private async loadState(): Promise<{ records: TestAccountRecord[]; updatedAt?: string }> {
    const record = await this.appConfigService.getRecord(COMMON_APP_ID, TEST_ACCOUNT_CONFIG_KEY);
    if (!record) {
      return { records: [] };
    }
    return {
      records: this.parseRecords(record.configValue),
      updatedAt: record.updatedAt,
    };
  }

  private parseRecords(raw: string): TestAccountRecord[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored test account config is invalid.");
    }
    const items = (parsed as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored test account config is invalid.");
    }
    return items.map((item) => this.normalizeStoredRecord(item));
  }

  private normalizeStoredRecord(input: unknown): TestAccountRecord {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored test account config is invalid.");
    }
    const source = input as Record<string, unknown>;
    return {
      id: this.requireStoredString(source.id),
      appId: this.requireStoredString(source.appId),
      phoneNa: this.requireStoredString(source.phoneNa),
      phone: this.requireStoredString(source.phone),
      label: typeof source.label === "string" ? source.label : "",
      enabled: source.enabled !== false,
      verifyCode: this.requireStoredString(source.verifyCode),
      createdAt: this.requireStoredString(source.createdAt),
      updatedAt: this.requireStoredString(source.updatedAt),
    };
  }

  private toDocument(records: TestAccountRecord[], updatedAt?: string): AdminTestAccountDocument {
    return {
      app: COMMON_APP_SUMMARY,
      configKey: TEST_ACCOUNT_CONFIG_KEY,
      items: records.map((item) => this.toAdminItem(item)),
      updatedAt,
    };
  }

  private toAdminItem(record: TestAccountRecord): AdminTestAccountItem {
    return {
      id: record.id,
      appId: record.appId,
      phoneNa: record.phoneNa,
      phone: record.phone,
      phoneMasked: this.maskPhone(record.phone),
      label: record.label,
      enabled: record.enabled,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private createVerifyCode(): string {
    const code = this.codeGenerator();
    if (!/^\d{6}$/.test(code)) {
      throw new Error("Test account verify code generator must return a six-digit code.");
    }
    return code;
  }

  private maskPhone(phone: string): string {
    const normalized = phone.trim();
    if (normalized.length <= 5) {
      return normalized;
    }
    return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      badRequest("REQ_INVALID_BODY", `${field} must be a non-empty string.`);
    }
    return value.trim();
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private requireStoredString(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored test account config is invalid.");
    }
    return value.trim();
  }
}
