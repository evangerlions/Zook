import { createHash } from "node:crypto";
import type { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { CommonPasswordConfigService } from "./common-password-config.service.ts";
import { probeDirectTls } from "./llm-upstream-direct-probe.ts";
import type { LlmUpstreamFailureDiagnostic } from "./llm-upstream-diagnostics-types.ts";

const KV_SCOPE = "llm-upstream-diagnostics";
const PROBE_COOLDOWN_SECONDS = 5 * 60;
const PROBE_TIMEOUT_MS = 3_000;
const MAX_LOCAL_THROTTLE_KEYS = 128;
type ProbeResult = Record<string, unknown> & {
  outcome: string;
  elapsedMs: number;
};

interface LlmUpstreamDiagnosticsOptions {
  fetchImplementation?: typeof fetch;
  probeDirectHost?: (hostname: string, timeoutMs: number) => Promise<ProbeResult>;
  now?: () => number;
}

interface ConnectivityTarget {
  transport: "direct" | "transparent_proxy";
  host: string;
  proxyBaseUrl?: string;
}

/** Adds bounded, best-effort network diagnostics without changing provider outcomes. */
export class LlmUpstreamDiagnosticsService {
  private readonly localThrottleTimes = new Map<string, number>();
  private readonly fetchImplementation: typeof fetch;
  private readonly probeDirectHost: NonNullable<LlmUpstreamDiagnosticsOptions["probeDirectHost"]>;
  private readonly now: () => number;

  constructor(
    private readonly commonLlmConfigService: CommonLlmConfigService,
    private readonly commonPasswordConfigService: CommonPasswordConfigService,
    private readonly kvManager: KVManager,
    private readonly logger: StructuredLogger,
    options: LlmUpstreamDiagnosticsOptions = {},
  ) {
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
    this.probeDirectHost = options.probeDirectHost ?? probeDirectTls;
    this.now = options.now ?? Date.now;
  }

  async reportFailure(input: LlmUpstreamFailureDiagnostic): Promise<void> {
    if (!shouldDiagnoseFailure(input)) return;
    this.logger.warn("LLM upstream request failed", { ...input });
    if (!shouldProbeConnectivity(input)) return;

    let target: ConnectivityTarget;
    try {
      target = await this.resolveConnectivityTarget(input);
    } catch (error) {
      this.logger.warn("LLM upstream connectivity probe skipped", {
        diagnosticId: input.diagnosticId,
        provider: input.provider,
        reason: "diagnostic_route_resolution_failed",
        errorCode: errorCode(error),
      });
      return;
    }

    const throttleKey = createThrottleKey(
      target.transport,
      target.host,
      target.proxyBaseUrl,
    );
    const throttleMode = await this.claimProbeSlot(throttleKey);
    if (throttleMode === "limited") return;
    if (throttleMode === "unavailable") {
      this.logger.warn("LLM upstream connectivity probe skipped", {
        diagnosticId: input.diagnosticId,
        provider: input.provider,
        transport: target.transport,
        targetHost: target.host,
        reason: "shared_throttle_unavailable",
        cooldownSeconds: PROBE_COOLDOWN_SECONDS,
        throttleMode: "fail_closed",
      });
      return;
    }

    const result = target.transport === "transparent_proxy" && target.proxyBaseUrl
      ? await this.probeProxyHealth(target.proxyBaseUrl)
      : await this.probeDirectHost(target.host, PROBE_TIMEOUT_MS);
    this.logger.info("LLM upstream connectivity probe completed", {
      diagnosticId: input.diagnosticId,
      provider: input.provider,
      transport: target.transport,
      targetHost: target.host,
      throttleMode,
      cooldownSeconds: PROBE_COOLDOWN_SECONDS,
      ...result,
    });
  }

  private async resolveConnectivityTarget(
    input: LlmUpstreamFailureDiagnostic,
  ): Promise<ConnectivityTarget> {
    const provider = input.provider.toLowerCase();
    if (provider !== "bai" && provider !== "openrouter") {
      return { transport: "direct", host: input.requestedHost };
    }

    const config = await this.commonLlmConfigService.getCurrentConfig();
    const proxyConfig = provider === "bai" ? config.bai : config.openRouter;
    const expectedOriginHost = provider === "bai" ? "api.b.ai" : "openrouter.ai";
    if (
      !proxyConfig.useTransparentProxy ||
      input.requestedHost.toLowerCase() !== expectedOriginHost
    ) {
      return { transport: "direct", host: input.requestedHost };
    }

    const secret = await this.commonPasswordConfigService.getValue(
      proxyConfig.transparentProxyHmacSecretKey,
    );
    if (!secret?.trim()) {
      return { transport: "direct", host: input.requestedHost };
    }

    const proxyUrl = new URL(proxyConfig.transparentProxyBaseUrl);
    return {
      transport: "transparent_proxy",
      host: proxyUrl.hostname,
      proxyBaseUrl: proxyConfig.transparentProxyBaseUrl,
    };
  }

  private async claimProbeSlot(
    throttleKey: string,
  ): Promise<"distributed" | "limited" | "unavailable"> {
    if (this.hasRecentLocalProbe(throttleKey)) return "limited";
    try {
      const claimed = await this.kvManager.setStringIfAbsent(
        KV_SCOPE,
        throttleKey,
        String(this.now()),
        PROBE_COOLDOWN_SECONDS,
      );
      this.rememberLocalProbe(throttleKey);
      return claimed ? "distributed" : "limited";
    } catch {
      return this.claimLocalProbeSlot(throttleKey) ? "unavailable" : "limited";
    }
  }

  private hasRecentLocalProbe(key: string): boolean {
    const previous = this.localThrottleTimes.get(key);
    if (previous === undefined) return false;
    if (this.now() - previous < PROBE_COOLDOWN_SECONDS * 1_000) return true;
    this.localThrottleTimes.delete(key);
    return false;
  }

  private claimLocalProbeSlot(key: string): boolean {
    if (this.hasRecentLocalProbe(key)) return false;
    this.rememberLocalProbe(key);
    return true;
  }

  private rememberLocalProbe(key: string): void {
    this.localThrottleTimes.delete(key);
    this.localThrottleTimes.set(key, this.now());
    while (this.localThrottleTimes.size > MAX_LOCAL_THROTTLE_KEYS) {
      const oldestKey = this.localThrottleTimes.keys().next().value;
      if (!oldestKey) break;
      this.localThrottleTimes.delete(oldestKey);
    }
  }

  private async probeProxyHealth(proxyBaseUrl: string): Promise<ProbeResult> {
    const healthUrl = buildProxyHealthUrl(proxyBaseUrl);
    const startedAt = this.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await this.fetchImplementation(healthUrl, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
      void response.body?.cancel().catch(() => {});
      return {
        outcome: response.status >= 300 && response.status < 400
          ? "http_redirect"
          : response.ok
            ? "healthy"
            : "http_response_not_ok",
        statusCode: response.status,
        elapsedMs: this.now() - startedAt,
      };
    } catch (error) {
      return {
        outcome: controller.signal.aborted ? "probe_timeout" : "network_error",
        errorCode: errorCode(error),
        elapsedMs: this.now() - startedAt,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function shouldDiagnoseFailure(input: LlmUpstreamFailureDiagnostic): boolean {
  if (input.errorCode === "LLM_SERVICE_NOT_CONFIGURED") return false;
  const successfulHttpResponse = input.responseStatus !== undefined &&
    input.responseStatus >= 200 && input.responseStatus < 300;
  return input.responseStatus === undefined || input.responseStatus >= 500 ||
    successfulHttpResponse ||
    Boolean(input.errorReason?.toLowerCase().includes("timeout"));
}

function shouldProbeConnectivity(input: LlmUpstreamFailureDiagnostic): boolean {
  return input.responseStatus === undefined || input.responseStatus >= 500 ||
    /timeout/i.test(input.errorCode) ||
    Boolean(input.errorReason?.toLowerCase().includes("timeout"));
}

function buildProxyHealthUrl(proxyBaseUrl: string): string {
  const url = new URL(proxyBaseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/_proxy/health`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function createThrottleKey(
  transport: string,
  host: string,
  proxyBaseUrl?: string,
): string {
  const route = proxyBaseUrl ? new URL(proxyBaseUrl).pathname : "";
  const digest = createHash("sha256")
    .update(`${transport}:${host.toLowerCase()}:${route}`)
    .digest("hex");
  return `probe:${digest}`;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN_ERROR";
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(code)) return code;
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}
