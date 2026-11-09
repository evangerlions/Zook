import { marketError, MarketDataError } from "./market.validation.ts";
const HOSTS = new Set([
  "api.tushare.pro",
  "push2his.eastmoney.com",
  "proxy.finance.qq.com",
]);
export class MarketTransport {
  constructor(readonly fetcher: typeof fetch = fetch) {}
  async text(url: string, init: RequestInit, signal: AbortSignal) {
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      !HOSTS.has(u.hostname) ||
      u.port ||
      u.username ||
      u.password
    )
      marketError("INVALID_ENDPOINT", 422);
    const combined = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      combined.throwIfAborted();
      const response = await this.fetcher(url, {
        ...init,
        signal: combined,
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        marketError(response.status === 429 ? "RATE_LIMIT" : "HTTP_ERROR");
      }
      if (
        Number(response.headers.get("content-length") ?? 0) >
        2 * 1024 * 1024
      ) {
        await response.body?.cancel();
        marketError("RESPONSE_TOO_LARGE");
      }
      reader = response.body?.getReader();
      if (!reader) marketError("EMPTY_RESPONSE");
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0,
        raw = "";
      while (true) {
        combined.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 2 * 1024 * 1024) marketError("RESPONSE_TOO_LARGE");
        raw += decoder.decode(part.value, { stream: true });
      }
      raw += decoder.decode();
      combined.throwIfAborted();
      return raw;
    } catch (error: any) {
      if (combined.aborted)
        marketError(signal.aborted ? "CANCELLED" : "TIMEOUT");
      if (error instanceof MarketDataError) throw error;
      marketError("CONNECTION_FAILED");
    } finally {
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
  }
}
