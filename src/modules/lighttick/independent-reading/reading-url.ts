import { fail, text } from "../learning/native-learning.validation.ts";
import { isIP } from "node:net";
import { publicSourceAddress } from "../learning/learning-sources.ts";
export function readingURL(raw: unknown): string {
  let u: URL;
  try {
    u = new URL(text(raw, 1500, true));
  } catch {
    fail(422, "请输入可核对的公网来源链接。");
  }
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && u.port !== (u.protocol === "https:" ? "443" : "80"))
  )
    fail(422, "仅支持无凭据、默认端口的公网HTTP或HTTPS来源。");
  u.hash = "";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    (isIP(host) && !publicSourceAddress(host))
  )
    fail(422, "来源必须使用可公开访问的地址。");
  return u.toString();
}
