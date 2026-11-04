import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { sourceAvailable, knowledgeFields } from "./knowledge.service.ts";
import { factKinds, type FactKind } from "./review.types.ts";
import { collectReviewFacts } from "./review.facts.ts";
import {
  digest,
  fail,
  integer,
} from "../learning/native-learning.validation.ts";
import { ApplicationError } from "../../../shared/errors.ts";
export class ReviewService {
  constructor(
    readonly repo: LightTickRepository,
    readonly authorize: () => Promise<void> = async () => {},
  ) {}
  async source(o: LightTickOwner, q: Record<string, string | undefined>) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const source = knowledgeFields({
        kind: "knowledge",
        title: "Source",
        body: "Source",
        tags: [],
        sources: [{ kind: q.kind, id: q.id, version: q.version }],
      }).sources[0];
      if (!(await sourceAvailable(this.repo, o, source)))
        fail(403, "The exact source is unavailable.");
      if (source.kind === "record") {
        const r = (await this.repo.getRecordVersion(
            o,
            source.id,
            Number(source.version),
          ))!,
          current = (await this.repo.getRecord(o, source.id))!;
        return {
          source,
          title: "记录原文",
          text: r.raw_text,
          current_version: String(current.version),
        };
      }
      const l = (await this.repo.getNativeLesson(o, source.id))!,
        p = (await this.repo.getLessonPublication(
          o,
          source.id,
          source.version,
        ))!;
      return {
        source,
        title: l.title,
        text: p.content,
        current_version: l.publishedVersion!,
      };
    });
  }
  async snapshot(
    o: LightTickOwner,
    q: Record<string, string | undefined> = {},
  ) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const timezone = q.timezone ?? "Asia/Shanghai",
        query = q.q ?? "",
        kind = q.kind ?? "",
        limit = q.limit === undefined ? 30 : Number(q.limit);
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
      } catch {
        fail(422, "Select a valid IANA timezone.");
      }
      if (
        timezone.length > 100 ||
        query.length > 200 ||
        (kind && !factKinds.includes(kind as FactKind))
      )
        fail(422, "Review filter is invalid.");
      integer(limit, 1, 100);
      for (const value of [q.start, q.end])
        if (
          value &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            !Number.isFinite(Date.parse(value)) ||
            new Date(value).toISOString().slice(0, 10) !== value)
        )
          fail(422, "Review dates are invalid.");
      if (q.start && q.end && q.start > q.end)
        fail(422, "Review date range is invalid.");
      const snapshot = await collectReviewFacts(this.repo, o, timezone),
        filter = digest({
          query,
          kind,
          start: q.start ?? "",
          end: q.end ?? "",
          timezone,
        });
      let after = 0;
      if (q.cursor) {
        try {
          if (q.cursor.length > 2048) throw Error();
          const c = JSON.parse(Buffer.from(q.cursor, "base64url").toString());
          if (
            c.owner !== digest(o) ||
            c.filter !== filter ||
            c.revision !== snapshot.revision ||
            !Number.isInteger(c.after) ||
            c.after < 0
          )
            throw Error();
          after = c.after;
        } catch {
          throw new ApplicationError(
            409,
            "LIGHTTICK_REVIEW_CURSOR_EXPIRED",
            "Review changed; rebuild the read-only view and keep local drafts and pending requests.",
          );
        }
      }
      const all = snapshot.facts.filter(
        (f) =>
          (!kind || f.kind === kind) &&
          (!query ||
            (f.title + "\n" + f.text)
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase())) &&
          (!q.start || (!!f.date && f.date >= q.start)) &&
          (!q.end || (!!f.date && f.date <= q.end)),
      );
      const counts = Object.fromEntries(
        factKinds.map((k) => [k, all.filter((f) => f.kind === k).length]),
      );
      return {
        revision: snapshot.revision,
        timezone,
        items: all
          .slice(after, after + limit)
          .map(({ text, ...f }) => ({ ...f, excerpt: text.slice(0, 500) })),
        next_cursor:
          after + limit < all.length
            ? Buffer.from(
                JSON.stringify({
                  owner: digest(o),
                  filter,
                  revision: snapshot.revision,
                  after: after + limit,
                }),
              ).toString("base64url")
            : null,
        total: all.length,
        counts,
        active_days: new Set(all.flatMap((f) => (f.date ? [f.date] : []))).size,
        unknown_date_count: all.filter((f) => !f.date).length,
        metrics_version: "confirmed-facts-v1",
        explanation:
          "已保存内容与当前确认事实；记录按记录日期，执行按业务日期，其他时间按所选时区。学完、任务/行动完成、执行与自述实践反馈分别计数，不相加推断能力。撤权、归档与改版会重建投影；旧答案仍在原版本。",
      };
    });
  }
}
