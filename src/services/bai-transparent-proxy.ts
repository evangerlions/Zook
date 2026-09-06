import type { TransparentProxyFetchOptions } from "./openrouter-transparent-proxy.ts";
import { createTransparentProxyFetch } from "./openrouter-transparent-proxy.ts";

export function createBaiTransparentProxyFetch(
  options: TransparentProxyFetchOptions,
): typeof fetch {
  return createTransparentProxyFetch(
    options,
    (url) => url.protocol === "https:" && url.hostname.toLowerCase() === "api.b.ai",
    "B.AI",
  );
}
