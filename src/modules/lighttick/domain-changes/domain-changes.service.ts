import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { domains, type Domain } from "./domain-changes.types.ts";
import {
  digest,
  fail,
  integer,
  keys,
  object,
} from "../learning/native-learning.validation.ts";
const max = 9223372036854775807n;
const sequence = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= max;
export class DomainChangesService {
  constructor(
    readonly repo: LightTickRepository,
    readonly authorize: () => Promise<void> = async () => {},
  ) {}
  private cursor(o: LightTickOwner, domain: Domain | null, after: string) {
    return Buffer.from(
      JSON.stringify({ owner: digest(o), domain, after }),
    ).toString("base64url");
  }
  private position(o: LightTickOwner, domain: Domain | null, raw: string) {
    if (!/^[a-zA-Z0-9_-]{1,1024}$/.test(raw))
      fail(422, "变更游标无效，请重新读取当前范围。");
    let b: Record<string, unknown>;
    try {
      const bytes = Buffer.from(raw, "base64url");
      if (bytes.toString("base64url") !== raw) throw Error();
      b = object(JSON.parse(bytes.toString("utf8")));
    } catch {
      fail(422, "变更游标无法读取，请保留本机输入。");
    }
    keys(b!, ["owner", "domain", "after"]);
    if (b!.owner !== digest(o) || b!.domain !== domain)
      fail(409, "变更游标属于不同账号或领域，请重新开始核对。");
    if (!sequence(b!.after)) fail(422, "变更序列无效，请保留本机输入。");
    return b!.after as string;
  }
  async read(o: LightTickOwner, q: Record<string, string | undefined> = {}) {
    keys(q, ["domain", "cursor", "limit", "start"]);
    const domain = q.domain ?? null;
    if (domain !== null && !domains.includes(domain as Domain))
      fail(422, "请选择现有领域。");
    const limit = q.limit === undefined ? 50 : integer(Number(q.limit), 1, 100);
    if (
      q.start !== undefined &&
      (q.start !== "latest" || q.cursor !== undefined)
    )
      fail(422, "当前起点与游标不能同时指定。");
    const after =
      q.cursor === undefined
        ? "0"
        : this.position(o, domain as Domain | null, q.cursor);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      if (q.start === "latest")
        return {
          items: [],
          next_cursor: this.cursor(
            o,
            domain as Domain | null,
            await this.repo.domainChanges.head(o, domain as Domain | null),
          ),
          has_more: false,
        };
      const rows = await this.repo.domainChanges.page(
          o,
          domain as Domain | null,
          after,
          limit + 1,
        ),
        items = rows.slice(0, limit);
      return {
        items,
        next_cursor: this.cursor(
          o,
          domain as Domain | null,
          items.at(-1)?.sequence ?? after,
        ),
        has_more: rows.length > limit,
      };
    });
  }
}
