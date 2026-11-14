import { SaxesParser } from "saxes";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { createHash } from "node:crypto";
import { normalizeUrl } from "./reading.service.ts";
import type { FeedCandidate } from "./reading-workflow.types.ts";
const blocked = new BlockList();
const blocked6 = new BlockList();
const public6 = new BlockList();
public6.addSubnet("2000::", 3, "ipv6");
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(ip, bits, "ipv4");
for (const [ip, bits] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked6.addSubnet(ip, bits, "ipv6");
export function assertPublicAddress(ip: string) {
  const family = isIP(ip);
  if (
    !family ||
    (family === 4
      ? blocked.check(ip, "ipv4")
      : !public6.check(ip, "ipv6") || blocked6.check(ip, "ipv6"))
  )
    throw Error("Feed address is not public.");
}
export function feedUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    value.length > 1500
  )
    throw Error("Use a public HTTPS feed URL.");
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")))
    assertPublicAddress(url.hostname.replace(/^\[|\]$/g, ""));
  if (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local")
  )
    throw Error("Feed address is not public.");
  return url;
}
/** Resolve every redirect, reject mixed private DNS answers, and pin the validated address at connect time. */
export async function fetchReadingFeed(
  value: string,
  deadline = Date.now() + 12000,
  redirects = 0,
): Promise<string> {
  const url = feedUrl(value);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw Error("Feed timeout.");
  const addresses = await Promise.race([
    lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true }),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(Error("DNS timeout.")),
        Math.min(remaining, 3000),
      );
      timer.unref();
    }),
  ]);
  if (!addresses.length) throw Error("Empty DNS.");
  for (const address of addresses) assertPublicAddress(address.address);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => req.destroy(Error("Feed timeout.")),
      Math.max(1, Math.min(6000, deadline - Date.now())),
    );
    const req = request(
      url,
      {
        family: addresses[0].family,
        headers: {
          Accept: "application/rss+xml, application/atom+xml, application/xml",
          "User-Agent": "LightTick-Reading/1.0",
        },
        lookup: (_host, _opts, callback) =>
          callback(null, addresses[0].address, addresses[0].family),
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          res.destroy();
          clearTimeout(timer);
          if (!res.headers.location || redirects >= 3) {
            reject(Error("Feed redirect limit."));
            return;
          }
          fetchReadingFeed(
            new URL(res.headers.location, url).href,
            deadline,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.destroy();
          reject(Error("Feed HTTP failure."));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1000000) {
            req.destroy(Error("Feed too large."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}
function decode(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(
      /&(amp|lt|gt|quot|apos);/g,
      (_, name) =>
        (
          ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }) as Record<
            string,
            string
          >
        )[name]!,
    )
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const n =
        code[0].toLowerCase() === "x"
          ? parseInt(code.slice(1), 16)
          : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    });
}
const plain = (value: string) =>
  decode(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export function parseReadingFeed(raw: string, base: string): FeedCandidate[] {
  if (Buffer.byteLength(raw) > 1000000 || /<!DOCTYPE|<!ENTITY|\x00/i.test(raw))
    throw Error("Unsupported feed.");
  const parser = new SaxesParser({ xmlns: true });
  const candidates: FeedCandidate[] = [],
    stack: string[] = [];
  const seen = new Set<string>();
  let root = "",
    entryDepth = 0,
    fields: Record<string, string> | null = null,
    atomUrl = "";
  parser.on("opentag", (node) => {
    stack.push(node.local);
    if (stack.length > 64) throw Error("Feed nesting exceeds limit.");
    if (stack.length === 1) root = node.local;
    if (!fields && ["item", "entry"].includes(node.local)) {
      fields = {};
      entryDepth = stack.length;
      atomUrl = "";
    }
    if (fields && stack.length === entryDepth + 1 && node.local === "link") {
      const attrs = Object.fromEntries(
        Object.values(node.attributes).map((a) => [a.local, a.value]),
      );
      if (attrs.href && (!attrs.rel || attrs.rel === "alternate"))
        atomUrl = attrs.href;
    }
  });
  const append = (value: string) => {
    const field = stack[entryDepth];
    if (
      fields &&
      field &&
      [
        "title",
        "link",
        "description",
        "summary",
        "content",
        "encoded",
      ].includes(field)
    )
      fields[field] = ((fields[field] ?? "") + value).slice(0, 6000);
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    if (fields && stack.length === entryDepth) {
      const title = plain(fields.title ?? "").slice(0, 300),
        link = fields.link || atomUrl;
      if (title && link && candidates.length < 30) {
        try {
          const url = normalizeUrl(new URL(link.trim(), base).href),
            parsed = new URL(url);
          if (
            url.length > 1500 ||
            parsed.username ||
            parsed.password ||
            parsed.hostname === "localhost" ||
            parsed.hostname.endsWith(".localhost") ||
            parsed.hostname.endsWith(".local")
          )
            throw Error("Invalid article link.");
          const literal = parsed.hostname.replace(/^\[|\]$/g, "");
          if (isIP(literal)) assertPublicAddress(literal);
          if (!seen.has(url)) {
            seen.add(url);
            candidates.push({
              id: createHash("sha256").update(url).digest("hex").slice(0, 24),
              url,
              title,
              summary: plain(
                fields.description ||
                  fields.summary ||
                  fields.content ||
                  fields.encoded ||
                  "",
              ).slice(0, 4000),
              source: new URL(base).hostname,
              language: "en",
              topic: "",
            });
          }
        } catch {
          /* Ignore an individual entry with an unsafe or malformed URL. */
        }
      }
      fields = null;
      entryDepth = 0;
    }
    stack.pop();
  });
  parser.write(raw).close();
  if (!["rss", "feed", "RDF"].includes(root)) throw Error("Unsupported feed.");
  return candidates;
}
