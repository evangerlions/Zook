import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";

type ResolvedAddress = { address: string; family: number };
type ProbeOutcome =
  | "dns_error"
  | "dns_no_results"
  | "dns_timeout"
  | "tcp_error"
  | "tcp_timeout"
  | "tls_error"
  | "tls_timeout"
  | "tls_connected";

export interface DirectProbeResult extends Record<string, unknown> {
  outcome: ProbeOutcome;
  elapsedMs: number;
}

interface DirectProbeDependencies {
  lookupHost?: (hostname: string) => Promise<ResolvedAddress[]>;
  connectTlsAddress?: (
    address: ResolvedAddress,
    hostname: string,
    timeoutMs: number,
  ) => Promise<DirectProbeResult>;
  now?: () => number;
}

/** DNS/TCP/TLS-only probe; it never sends provider credentials or a model request. */
export async function probeDirectTls(
  hostname: string,
  timeoutMs: number,
  dependencies: DirectProbeDependencies = {},
): Promise<DirectProbeResult> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  let addresses: ResolvedAddress[];
  try {
    const lookupHost = dependencies.lookupHost ?? defaultLookupHost;
    addresses = await withTimeout(lookupHost(hostname), timeoutMs);
  } catch (error) {
    return {
      outcome: errorCode(error) === "ETIMEDOUT" ? "dns_timeout" : "dns_error",
      errorCode: errorCode(error),
      elapsedMs: now() - startedAt,
    };
  }

  const dnsMs = now() - startedAt;
  if (addresses.length === 0) {
    return {
      outcome: "dns_no_results",
      dnsMs,
      resolvedAddressCount: 0,
      attemptedAddressCount: 0,
      elapsedMs: dnsMs,
    };
  }

  const connectTlsAddress = dependencies.connectTlsAddress ?? defaultConnectTlsAddress;
  let attemptedAddressCount = 0;
  let lastResult: DirectProbeResult | undefined;
  for (const address of addresses) {
    const remainingMs = timeoutMs - (now() - startedAt);
    if (remainingMs <= 0) break;

    attemptedAddressCount += 1;
    try {
      lastResult = await connectTlsAddress(address, hostname, remainingMs);
    } catch (error) {
      lastResult = {
        outcome: "tcp_error",
        errorCode: errorCode(error),
        elapsedMs: now() - startedAt,
      };
    }
    if (lastResult.outcome === "tls_connected") {
      return {
        ...lastResult,
        dnsMs,
        resolvedAddressCount: addresses.length,
        attemptedAddressCount,
        elapsedMs: now() - startedAt,
      };
    }
    if (lastResult.outcome === "tcp_timeout" || lastResult.outcome === "tls_timeout") {
      break;
    }
  }

  return {
    ...(lastResult ?? { outcome: "tcp_timeout", errorCode: "ETIMEDOUT" }),
    dnsMs,
    resolvedAddressCount: addresses.length,
    attemptedAddressCount,
    elapsedMs: now() - startedAt,
  } as DirectProbeResult;
}

async function defaultLookupHost(hostname: string): Promise<ResolvedAddress[]> {
  return await lookup(hostname, { all: true }) as ResolvedAddress[];
}

function defaultConnectTlsAddress(
  address: ResolvedAddress,
  hostname: string,
  timeoutMs: number,
): Promise<DirectProbeResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let tcpConnectedAt: number | undefined;
    let completed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const socket = tlsConnect({
      host: address.address,
      port: 443,
      ...(isIP(hostname) ? {} : { servername: hostname }),
    });
    const finish = (result: DirectProbeResult) => {
      if (completed) return;
      completed = true;
      if (timeout) clearTimeout(timeout);
      socket.destroy();
      resolve(result);
    };
    timeout = setTimeout(() => {
      finish({
        outcome: tcpConnectedAt === undefined ? "tcp_timeout" : "tls_timeout",
        errorCode: "ETIMEDOUT",
        ...(tcpConnectedAt === undefined
          ? {}
          : { tcpConnectMs: tcpConnectedAt - startedAt }),
        elapsedMs: Date.now() - startedAt,
      });
    }, timeoutMs);

    socket.once("connect", () => {
      tcpConnectedAt = Date.now();
    });
    socket.once("secureConnect", () => {
      const completedAt = Date.now();
      finish({
        outcome: "tls_connected",
        tcpConnectMs: (tcpConnectedAt ?? completedAt) - startedAt,
        tlsHandshakeMs: tcpConnectedAt === undefined
          ? 0
          : completedAt - tcpConnectedAt,
        elapsedMs: completedAt - startedAt,
      });
    });
    socket.once("error", (error) => {
      finish({
        outcome: tcpConnectedAt === undefined ? "tcp_error" : "tls_error",
        ...(tcpConnectedAt === undefined
          ? {}
          : { tcpConnectMs: tcpConnectedAt - startedAt }),
        errorCode: errorCode(error),
        elapsedMs: Date.now() - startedAt,
      });
    });
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(Object.assign(new Error("DNS diagnostic probe timed out"), { code: "ETIMEDOUT" })),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN_ERROR";
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(code)) return code;
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}
