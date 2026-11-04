import { marketError } from "./market.validation.ts";
/** Preserve JSON numeric lexemes before JSON.parse can round them to binary floats. */
export function marketJson(raw: string): any {
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024)
    marketError("RESPONSE_TOO_LARGE");
  let out = "",
    depth = 0;
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  for (let i = 0; i < raw.length; ) {
    const ch = raw[i];
    if (ch === '"') {
      const start = i++;
      let closed = false;
      while (i < raw.length) {
        if (raw[i] === "\\") {
          i += 2;
          continue;
        }
        if (raw[i++] === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) marketError("INVALID_JSON");
      out += raw.slice(start, i);
      continue;
    }
    if (ch === "{" || ch === "[") {
      if (++depth > 40) marketError("JSON_DEPTH");
    } else if (ch === "}" || ch === "]") --depth;
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      number.lastIndex = i;
      const match = number.exec(raw);
      if (!match || match[0].length > 120) marketError("INVALID_JSON_NUMBER");
      out += JSON.stringify(match[0]);
      i = number.lastIndex;
    } else {
      out += ch;
      ++i;
    }
  }
  try {
    return JSON.parse(out);
  } catch {
    marketError("INVALID_JSON");
  }
}
