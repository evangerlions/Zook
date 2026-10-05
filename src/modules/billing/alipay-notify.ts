import { ApplicationError } from "../../shared/errors.ts";
export const ALIPAY_NOTIFY_MAX_BYTES = 16 * 1024;
/** Decode once, reject ambiguous duplicate parameters before signature verification. */
export function parseAlipayNotify(body: unknown): Record<string, string> {
  if (!Buffer.isBuffer(body) || body.length > ALIPAY_NOTIFY_MAX_BYTES || body.length === 0) invalid();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  const fields: Record<string, string> = Object.create(null);
  for (const part of text.split("&")) {
    const index = part.indexOf("=");
    if (index <= 0) invalid();
    let key: string, value: string;
    try { key = decodeURIComponent(part.slice(0, index).replaceAll("+", " ")); value = decodeURIComponent(part.slice(index + 1).replaceAll("+", " ")); }
    catch { invalid(); }
    if (!/^[a-zA-Z0-9_]{1,64}$/.test(key!) || Object.hasOwn(fields, key!) || Object.keys(fields).length >= 80) invalid();
    fields[key!] = value!;
  }
  if (fields.notify_id && !/^[A-Za-z0-9_-]{1,128}$/.test(fields.notify_id)) invalid();
  return fields;
}
function invalid(): never { throw new ApplicationError(400, "BILLING_NOTIFY_INVALID", "Invalid Alipay form notification."); }
