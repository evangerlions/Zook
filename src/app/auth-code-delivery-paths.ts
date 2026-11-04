import type { HttpRequest } from "../shared/types.ts";

const publicPaths = new Set([
  "/api/v1/auth/register/email-code", "/api/v1/auth/login/email-code", "/api/v1/auth/password/email-code",
  "/api/v1/auth/register/sms-code", "/api/v1/auth/login/sms-code", "/api/v1/auth/password/sms-code",
]);
const productPaths = new Set([
  "/api/v1/frogsleep/auth/email/send-code", "/api/v1/frogsleep/auth/email/auth-code",
  "/api/v1/frogsleep/auth/email/change-code", "/api/v1/frogsleep/auth/password/reset/request",
]);

/** Delivery endpoints reserve their code in a short transaction before contacting the provider. */
export function isAuthCodeDeliveryRequest(request: HttpRequest): boolean {
  if (request.method !== "POST") return false;
  if (publicPaths.has(request.path) || productPaths.has(request.path)) return true;
  if (!["/api/v1/frogsleep/auth/email/register", "/api/v1/frogsleep/auth/password/register"].includes(request.path)) return false;
  const body = request.body as Record<string, unknown> | undefined;
  return !["email_code", "emailCode", "code"].some(key => typeof body?.[key] === "string" && (body[key] as string).trim());
}
