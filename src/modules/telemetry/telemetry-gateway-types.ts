export type TelemetryLane = "ga4" | "sentry";

export interface Ga4TelemetryDestination {
  measurementId: string;
  apiSecret: string;
}

export interface SentryTelemetryDestination {
  projectId: string;
  publicKey: string;
  ingestOrigin: string;
}

export interface TelemetryGatewayConfig {
  ga4?: Ga4TelemetryDestination;
  sentry?: SentryTelemetryDestination;
  timeoutMs?: number;
  bodyTimeoutMs?: number;
  rateLimitPerMinute?: number;
}

export interface TelemetryGatewayRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  discardBody?: () => void;
  ipAddress?: string;
  requestId?: string;
}

export interface TelemetryGatewayResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: Uint8Array;
  requestId: string;
}
