export class RevenueCatApiError extends Error {
  constructor(readonly reason: "not_configured" | "request_failed" | "invalid_response") {
    super("RevenueCat customer lookup failed.");
    this.name = "RevenueCatApiError";
  }
}

export interface RevenueCatCustomerApiOptions {
  secretApiKey?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

const MAX_RESPONSE_BYTES = 1_000_000;

export class RevenueCatCustomerApi {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: RevenueCatCustomerApiOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async getSubscriber(appUserId: string, requestSignal?: AbortSignal): Promise<unknown> {
    const apiKey = this.options.secretApiKey?.trim();
    if (!apiKey) throw new RevenueCatApiError("not_configured");

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, timeout.signal])
      : timeout.signal;
    try {
      const response = await this.fetcher(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          signal,
        },
      );
      if (!response.ok) throw new RevenueCatApiError("request_failed");
      try {
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
          throw new RevenueCatApiError("invalid_response");
        }
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
          throw new RevenueCatApiError("invalid_response");
        }
        const payload: unknown = JSON.parse(text);
        if (!isObject(payload) || !isObject(payload.subscriber)) {
          throw new RevenueCatApiError("invalid_response");
        }
        return payload;
      } catch (error) {
        if (error instanceof RevenueCatApiError) throw error;
        throw new RevenueCatApiError("invalid_response");
      }
    } catch (error) {
      if (error instanceof RevenueCatApiError) throw error;
      throw new RevenueCatApiError("request_failed");
    } finally {
      clearTimeout(timer);
    }
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
