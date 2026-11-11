import { fail, text } from "../learning/native-learning.validation.ts";
export function readingURL(raw: unknown): string {
  let u: URL;
  try {
    u = new URL(text(raw, 1500, true));
  } catch {
    fail(422, "请输入可核对的HTTPS来源链接。");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    fail(422, "仅支持无凭据、443端口的HTTPS来源。");
  u.hash = "";
  return u.toString();
}
