import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

type ProxyEnvironment = Record<string, string | undefined>;

export function createBaiProxyAwareFetch(
  environment: ProxyEnvironment = process.env,
): typeof fetch | undefined {
  const httpProxy = environment.http_proxy ?? environment.HTTP_PROXY;
  const httpsProxy = environment.https_proxy ?? environment.HTTPS_PROXY;
  if (!httpProxy && !httpsProxy) {
    return undefined;
  }

  const dispatcher = new EnvHttpProxyAgent({
    ...(httpProxy ? { httpProxy } : {}),
    ...(httpsProxy ? { httpsProxy } : {}),
    ...(environment.no_proxy ?? environment.NO_PROXY
      ? { noProxy: environment.no_proxy ?? environment.NO_PROXY }
      : {}),
  });

  return (async (input, init) =>
    await undiciFetch(input, {
      ...init,
      dispatcher,
    }) as unknown as Response) as typeof fetch;
}
