import type { StructuredLogger } from "./infrastructure/logging/pino-logger.module.ts";
import { TelemetryGateway } from "./modules/telemetry/telemetry-gateway.ts";
import type { TelemetryGatewayConfig } from "./modules/telemetry/telemetry-gateway-types.ts";
import type { CreateApplicationOptions } from "./application-options.ts";

export function createApplicationTelemetryGateway(
  options: CreateApplicationOptions,
  logger: StructuredLogger,
): TelemetryGateway {
  return new TelemetryGateway(
    resolveTelemetryGatewayConfig(options.telemetryGatewayConfig),
    logger,
    options.telemetryFetchImplementation,
  );
}

function resolveTelemetryGatewayConfig(
  override?: TelemetryGatewayConfig,
): TelemetryGatewayConfig {
  if (override) {
    return override;
  }
  return {
    ga4: resolveGa4Destination(),
    sentry: resolveSentryDestination(),
  };
}

function resolveGa4Destination() {
  const measurementId = process.env.GA4_ORANGEWRITE_MEASUREMENT_ID?.trim();
  const apiSecret = process.env.GA4_ORANGEWRITE_API_SECRET?.trim();
  return measurementId && apiSecret ? { measurementId, apiSecret } : undefined;
}

function resolveSentryDestination() {
  const projectId = process.env.SENTRY_ORANGEWRITE_PROJECT_ID?.trim();
  const publicKey = process.env.SENTRY_ORANGEWRITE_PUBLIC_KEY?.trim();
  const ingestOrigin = process.env.SENTRY_ORANGEWRITE_INGEST_ORIGIN?.trim();
  return projectId && publicKey && ingestOrigin
    ? { projectId, publicKey, ingestOrigin }
    : undefined;
}
