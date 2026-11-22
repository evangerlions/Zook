import type { LightTickOwner } from "../lighttick.types.ts";
import {
  digest,
  object,
  keys,
  fail,
} from "../learning/native-learning.validation.ts";
export function experienceCursor(
  o: LightTickOwner,
  scope: unknown,
  head: string,
  after: unknown,
) {
  return Buffer.from(
    JSON.stringify({ owner: digest(o), scope: digest(scope), head, after }),
  ).toString("base64url");
}
export function decodeExperienceCursor(
  o: LightTickOwner,
  scope: unknown,
  head: string,
  raw: string,
) {
  let b: Record<string, unknown>;
  try {
    if (!/^[a-zA-Z0-9_-]{1,4096}$/.test(raw)) throw Error();
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) throw Error();
    b = object(JSON.parse(bytes.toString("utf8")));
  } catch {
    fail(422, "分页游标无效，请保留输入重新核对。");
  }
  keys(b!, ["owner", "scope", "head", "after"]);
  if (b!.owner !== digest(o) || b!.scope !== digest(scope) || b!.head !== head)
    fail(409, "账号、查询或数据已变化，请从第一页重新核对。");
  return b!.after;
}
