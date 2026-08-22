import { isIP } from "node:net";

const LOOPBACK_ADDRESSES = ["127.0.0.1", "::1"];

export interface ClientAddressResolution {
  ipAddress?: string;
  trustedProxy: boolean;
}

export function resolveClientAddress(
  forwardedFor: string | string[] | undefined,
  remoteAddress: string | undefined,
  configuredTrustedProxies = process.env.ZOOK_TRUSTED_PROXY_IPS,
): ClientAddressResolution {
  const remote = normalizeIpAddress(remoteAddress);
  const trustedProxies = parseTrustedProxyAddresses(configuredTrustedProxies);
  if (!remote || !trustedProxies.has(remote)) {
    return { ipAddress: remote, trustedProxy: false };
  }

  const forwarded = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor)
    ?.split(",")
    .map(normalizeIpAddress)
    .filter((value): value is string => Boolean(value)) ?? [];
  while (forwarded.length > 0 && trustedProxies.has(forwarded.at(-1) as string)) {
    forwarded.pop();
  }
  return {
    ipAddress: forwarded.at(-1) ?? remote,
    trustedProxy: true,
  };
}

export function parseTrustedProxyAddresses(value?: string): Set<string> {
  const addresses = new Set(LOOPBACK_ADDRESSES);
  for (const candidate of value?.split(",") ?? []) {
    const normalized = normalizeIpAddress(candidate);
    if (normalized) {
      addresses.add(normalized);
    }
  }
  return addresses;
}

function normalizeIpAddress(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const withoutIpv4Mapping = trimmed.startsWith("::ffff:")
    ? trimmed.slice("::ffff:".length)
    : trimmed;
  return isIP(withoutIpv4Mapping) ? withoutIpv4Mapping : undefined;
}
