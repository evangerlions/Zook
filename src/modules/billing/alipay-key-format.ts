import { createPrivateKey } from "node:crypto";

/** Chat exports raw DER text; normalize PKCS#1/PKCS#8 to an explicit PEM. */
export function normalizeAlipayPrivateKey(value: string): string {
  const text = value.trim();
  if (text.includes("-----BEGIN")) {
    return createPrivateKey(text).export({ type: "pkcs8", format: "pem" }).toString();
  }
  const bytes = Buffer.from(text.replace(/\s/g, ""), "base64");
  for (const type of ["pkcs8", "pkcs1"] as const) {
    try {
      return createPrivateKey({ key: bytes, format: "der", type })
        .export({ type: "pkcs8", format: "pem" }).toString();
    } catch { /* Try the other supported format without exposing key material. */ }
  }
  throw new Error("Alipay private key format is invalid.");
}
