import { CommonPasswordConfigService } from "./common-password-config.service.ts";

const SECRET_REFERENCE_PATTERN = /^\{\{\s*zook\.ps\.([A-Za-z0-9._:-]+)\s*\}\}$/;

export function isSecretReference(value: string): boolean {
  return SECRET_REFERENCE_PATTERN.test(value.trim());
}

export function extractSecretReferenceKey(value: string): string | null {
  const match = value.trim().match(SECRET_REFERENCE_PATTERN);
  return match?.[1] ?? null;
}

export class SecretReferenceResolver {
  constructor(private readonly commonPasswordConfigService: CommonPasswordConfigService) {}

  async resolveString(value: string): Promise<string> {
    const key = extractSecretReferenceKey(value);
    if (!key) {
      return value;
    }

    const resolvedValue = await this.commonPasswordConfigService.getValue(key);
    if (!resolvedValue) {
      throw new Error(`Password key is not configured: ${key}`);
    }

    return resolvedValue;
  }

  async resolveValue<T>(value: T): Promise<T> {
    if (typeof value === "string") {
      return (await this.resolveString(value)) as T;
    }

    if (Array.isArray(value)) {
      return (await Promise.all(value.map((item) => this.resolveValue(item)))) as T;
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [key, await this.resolveValue(item)] as const),
    );

    return Object.fromEntries(entries) as T;
  }
}
