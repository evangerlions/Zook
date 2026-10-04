import { RevenueCatApiError, isObject, type RevenueCatResource } from "./ainovel-revenuecat-types.ts";
const ORIGIN = "https://api.revenuecat.com";
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_PAGES = 50;
/** Mutable read/pagination state belongs to one customer lookup. */
export class RevenueCatV2ReadSession {
  private readonly root: string;
  constructor(projectId: string, private readonly key: string,
    private readonly fetcher: typeof fetch, private readonly signal: AbortSignal) {
    this.root = `/v2/projects/${encodeURIComponent(projectId)}`;
  }
  items(value: unknown): RevenueCatResource[] {
    if (!isObject(value) || value.object !== "list" || !Array.isArray(value.items) ||
      !value.items.every(isObject)) throw new RevenueCatApiError("invalid_response");
    return value.items;
  }
  async list(path: string): Promise<RevenueCatResource[]> {
    const result: RevenueCatResource[] = [];
    const seen = new Set<string>();
    let url = this.url(path);
    for (let page = 0; page < MAX_PAGES; page++) {
      if (seen.has(url.href)) throw new RevenueCatApiError("invalid_response");
      seen.add(url.href);
      const body = await this.read(url);
      result.push(...this.items(body));
      if (body.next_page == null) return result;
      if (typeof body.next_page !== "string") throw new RevenueCatApiError("invalid_response");
      const next = new URL(body.next_page, ORIGIN);
      if (next.origin !== ORIGIN || next.pathname !== url.pathname || next.username || next.password) {
        throw new RevenueCatApiError("invalid_response");
      }
      url = next;
    }
    throw new RevenueCatApiError("invalid_response", { failureKind: "pagination_limit" });
  }
  async object(path: string): Promise<RevenueCatResource> { return this.read(this.url(path)); }
  private url(path: string): URL { return new URL(`${this.root}${path}`, ORIGIN); }
  private async read(url: URL): Promise<RevenueCatResource> {
    this.signal.throwIfAborted();
    const response = await this.fetcher(url.href, {
      method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${this.key}` },
      redirect: "error", signal: this.signal,
    });
    if (!response.ok) throw new RevenueCatApiError("request_failed", {
      httpStatus: response.status, failureKind: "http_error",
    });
    try {
      const size = Number(response.headers.get("content-length"));
      if (Number.isFinite(size) && size > MAX_RESPONSE_BYTES) throw new Error("oversized");
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("oversized");
      const body: unknown = JSON.parse(text);
      if (!isObject(body)) throw new Error("invalid object");
      return body;
    } catch {
      this.signal.throwIfAborted();
      throw new RevenueCatApiError("invalid_response", { httpStatus: response.status });
    }
  }
}
