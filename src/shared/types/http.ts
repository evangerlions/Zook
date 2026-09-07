import type { AdminSessionRecord } from "./records.ts";

export interface AccessTokenPayload {
  sub: string;
  app_id: string;
  type: "access";
  jti: string;
  ver: number;
  iat: number;
  exp: number;
}

export interface AuthContext {
  userId: string;
  appId: string;
  tokenId: string;
  tokenVersion: number;
  expiresAt: string;
}

export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: unknown;
  hostname?: string;
  ipAddress?: string;
  trustedProxy?: boolean;
  requestId?: string;
  cookies?: Record<string, string>;
  auth?: AuthContext;
  adminSession?: AdminSessionRecord | null;
  signal?: AbortSignal;
}

export interface HttpResponse<T> {
  statusCode: number;
  headers?: Record<string, string>;
  body: ResultEnvelope<T>;
  contentType?: string;
  streamBody?: AsyncIterable<string>;
}

export interface ResultEnvelope<T> {
  code: string;
  message: string;
  data: T;
  requestId: string;
}
