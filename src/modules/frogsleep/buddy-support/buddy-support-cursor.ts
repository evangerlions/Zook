import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { badRequest } from "../../../shared/errors.ts";
const developmentKey = randomBytes(32);
function key() {
  const configured = process.env.FROGSLEEP_SUPPORT_CURSOR_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("FROGSLEEP_SUPPORT_CURSOR_SECRET is required.");
  return developmentKey;
}
export function supportCursor(scope: string, value: Record<string, string>) {
  const payload = Buffer.from(JSON.stringify({ scope, value })).toString("base64url");
  return `${payload}.${createHmac("sha256", key()).update(payload).digest("base64url")}`;
}
export function readSupportCursor(scope: string, value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra) throw new Error();
    const expected = createHmac("sha256", key()).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (decoded.scope !== scope || typeof decoded.value !== "object") throw new Error();
    return decoded.value;
  } catch { badRequest("REQ_INVALID_QUERY", "Invalid support cursor."); }
}
