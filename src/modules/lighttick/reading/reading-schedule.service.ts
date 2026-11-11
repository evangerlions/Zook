import type { LightTickOwner } from "../lighttick.types.ts";
import type { ReadingWork } from "./reading-work.types.ts";
import type { ReadingScheduleDay } from "./reading-schedule.types.ts";
import { ReadingWorkService } from "./reading-work.service.ts";
import { ReadingRecommendationService } from "./reading-recommendation.service.ts";
import { validateReadingRecommendation } from "./reading-recommendation-context.ts";
import { readingShanghaiDate } from "./reading-recommendation.ts";
import { canonicalReadingURL } from "./reading-identity.ts";
import {
  digest,
  fail,
  integer,
  keys,
  object,
} from "../learning/native-learning.validation.ts";
function dayDate(value: string) {
  if (
    !/^\d{4}-\d\d-\d\d$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail(422, "Invalid reading business date");
  return value;
}
export class ReadingScheduleService {
  constructor(
    readonly work: ReadingWorkService,
    readonly authorizeOwner: (
      o: LightTickOwner,
    ) => Promise<void> = async () => {},
  ) {}
  data(row: ReadingScheduleDay) {
    return {
      ...row,
      expired: row.date < readingShanghaiDate(this.work.clock()),
    };
  }
  async read(o: LightTickOwner, date = readingShanghaiDate(this.work.clock())) {
    dayDate(date);
    return this.work.repo.transaction(o, async () => {
      await this.work.authorize();
      const row = await this.work.store.schedule.get(o, date);
      return { date, day: row ? this.data(row) : null };
    });
  }
  async history(o: LightTickOwner, before = "9999-12-31") {
    dayDate(before);
    return this.work.repo.transaction(o, async () => {
      await this.work.authorize();
      const rows = await this.work.store.schedule.history(o, before, 31);
      return {
        items: rows.slice(0, 30).map((r) => this.data(r)),
        next_cursor: rows.length > 30 ? rows[29].date : null,
      };
    });
  }
  async scan() {
    const now = this.work.clock(),
      date = readingShanghaiDate(now),
      minute =
        new Date(now.getTime() + 8 * 3600000).getUTCHours() * 60 +
        now.getUTCMinutes(),
      owners = await this.work.store.schedule.due(
        date,
        minute,
        now.toISOString(),
        20,
      );
    let created = 0,
      failed = 0;
    for (const owner of owners) {
      try {
        const id = await this.advance(owner, date);
        if (id) {
          await this.work.dispatch(owner, id);
          created++;
        }
      } catch (error: any) {
        if (error?.statusCode === 503) break;
        if ([401, 403, 404, 409, 413, 422].includes(error?.statusCode)) {
          try {
            await this.stopDenied(
              owner,
              date,
              [401, 403, 404].includes(error.statusCode)
                ? "OWNER_UNAVAILABLE"
                : "CONFIGURATION_UNAVAILABLE",
            );
          } catch {
            failed++;
          }
        } else failed++;
      }
    }
    return { checked: owners.length, created, failed };
  }
  private async stopDenied(o: LightTickOwner, date: string, code: string) {
    return this.work.repo.transaction(o, async () => {
      const prefs = await this.work.store.preferences.get(o);
      if (!prefs?.value.enabled) return;
      const old = await this.work.store.schedule.get(o, date),
        now = this.work.clock().toISOString(),
        row: ReadingScheduleDay = old ?? {
          date,
          revision: 0,
          preferences_revision: prefs.revision,
          goal: prefs.value.count,
          attempts: 0,
          phase: "pending",
          work_id: null,
          work_ids: [],
          adopted: [],
          skipped: [],
          next_at: now,
          error_code: null,
          created_at: now,
          updated_at: now,
        };
      await this.work.store.schedule.save(
        o,
        {
          ...row,
          revision: row.revision + 1,
          phase: "stopped",
          error_code: code,
          updated_at: now,
        },
        row.revision,
      );
    });
  }
  async stop(o: LightTickOwner, date: string, raw: unknown, key: string) {
    dayDate(date);
    const b = structuredClone(object(raw));
    keys(b, ["base_revision"]);
    const base = integer(b.base_revision, 1, 2147483646);
    return this.work.command(
      o,
      "reading-day-" + date,
      "schedule:stop",
      b,
      key,
      async () => {
        const old = await this.work.store.schedule.get(o, date);
        if (!old) fail(404, "Daily reading state not found");
        if (old.revision !== base || old.phase !== "pending")
          fail(409, "Daily reading state changed; retain the original request");
        if (old.work_id) {
          const row = await this.work.store.get(o, old.work_id);
          if (row && ["queued", "running"].includes(row.status))
            await this.work.cancel(
              o,
              row.id,
              { base_revision: row.revision },
              "reading-day-stop-" +
                digest([o.appId, o.userId, date, key]).slice(0, 40),
            );
        }
        const next = {
          ...old,
          revision: base + 1,
          phase: "stopped" as const,
          error_code: "CANCELLED",
          updated_at: this.work.clock().toISOString(),
        };
        await this.work.store.schedule.save(o, next, base);
        return this.data(next);
      },
    );
  }
  async advance(o: LightTickOwner, date: string): Promise<string | undefined> {
    dayDate(date);
    return this.work.repo.transaction(o, async () => {
      await this.authorizeOwner(o);
      const prefs = await this.work.store.preferences.get(o),
        now = this.work.clock().toISOString(),
        today = readingShanghaiDate(this.work.clock()),
        local = new Date(this.work.clock().getTime() + 8 * 3600000);
      if (
        date !== today ||
        !prefs?.value.enabled ||
        local.getUTCHours() * 60 + local.getUTCMinutes() <
          prefs.value.hour * 60 + prefs.value.minute
      )
        return;
      const old = await this.work.store.schedule.get(o, date);
      if (old && (old.phase !== "pending" || old.next_at > now)) return;
      let day: ReadingScheduleDay = old
        ? structuredClone(old)
        : {
            date,
            revision: 0,
            preferences_revision: prefs.revision,
            goal: prefs.value.count,
            attempts: 0,
            phase: "pending",
            work_id: null,
            work_ids: [],
            adopted: [],
            skipped: [],
            next_at: now,
            error_code: null,
            created_at: now,
            updated_at: now,
          };
      const save = async () => {
        if (readingShanghaiDate(this.work.clock()) !== date)
          throw Error("READING_DAILY_DATE_EXPIRED");
        await this.authorizeOwner(o);
        const base = day.revision;
        day = {
          ...day,
          revision: base + 1,
          updated_at: this.work.clock().toISOString(),
        };
        await this.work.store.schedule.save(o, day, base);
      };
      if (day.preferences_revision !== prefs.revision) {
        day.phase = "stopped";
        day.error_code = "PREFERENCES_CHANGED";
        await save();
        return;
      }
      if (day.work_id) {
        let row = await this.work.store.get(o, day.work_id);
        if (row && ["queued", "running"].includes(row.status)) return;
        if (!row) {
          day.phase = "stopped";
          day.error_code = "WORK_UNAVAILABLE";
          await save();
          return;
        }
        if (row.status === "cancelled") {
          day.phase = "stopped";
          day.error_code = "CANCELLED";
          await save();
          return;
        }
        if (row.error_code === "READING_CONTEXT_STALE") {
          day.phase = "stopped";
          day.error_code = "READING_CONTEXT_STALE";
          await save();
          return;
        }
        if (row.status === "succeeded") {
          try {
            await validateReadingRecommendation(this.work, row);
          } catch {
            day.phase = "stopped";
            day.error_code = "READING_CONTEXT_STALE";
            await save();
            return;
          }
          const history = await this.work.repo.reading.recommendationHistory(o);
          if (history.length > 10000)
            fail(413, "Reading history exceeds daily collection capacity");
          const seen = new Set(
            history.flatMap((h) =>
              h.source_url ? [canonicalReadingURL(h.source_url)] : [],
            ),
          );
          for (
            let index = 0;
            index < (row.output?.entry_refs?.length ?? 0) &&
            day.adopted.length < day.goal;
            index++
          ) {
            const reference = row.output!.entry_refs![index],
              existing = row.adopted[String(index)];
            if (existing) {
              if (
                !day.adopted.some((a) => a.article_id === existing.article_id)
              )
                day.adopted.push({ ...existing, work_id: row.id, index });
              continue;
            }
            if (
              reference.content.source_url &&
              seen.has(canonicalReadingURL(reference.content.source_url))
            ) {
              day.skipped.push({
                work_id: row.id,
                index,
                url: reference.content.source_url,
                reason: "already_saved",
              });
              continue;
            }
            if(await this.work.repo.readingErasure.contentTombstone(o,reference.content_digest)){
              day.skipped.push({work_id:row.id,index,url:reference.content.source_url??"",reason:"previously_deleted"});
              continue;
            }
            await this.authorizeOwner(o);
            if (readingShanghaiDate(this.work.clock()) !== date)
              throw Error("READING_DAILY_DATE_EXPIRED");
            const adopted = await this.work.adopt(
              o,
              row.id,
              {
                base_revision: row.revision,
                output_digest: digest(row.output),
                index,
                base_article_revision: null,
                response_view: "summary",
              },
              "reading-daily-adopt-" +
                digest([o.appId, o.userId, date, row.id, index]).slice(0, 40),
            );
            day.adopted.push({
              article_id: adopted.article_id,
              revision: adopted.revision,
              work_id: row.id,
              index,
            });
            if (reference.content.source_url)
              seen.add(canonicalReadingURL(reference.content.source_url));
            row = (await this.work.store.get(o, row.id))!;
          }
        }
        day.work_id = null;
        if (day.adopted.length >= day.goal) {
          day.phase = "complete";
          day.error_code = null;
        } else if (day.attempts >= 3) {
          day.phase = "complete";
          day.error_code = "INSUFFICIENT_READABLE_FULL_TEXT";
        } else {
          day.next_at = new Date(
            this.work.clock().getTime() + 15 * 60000,
          ).toISOString();
          day.error_code = row.error_code ?? "PARTIAL_READABLE_FULL_TEXT";
        }
        await save();
        return;
      }
      if (day.adopted.length >= day.goal || day.attempts >= 3) {
        day.phase = "complete";
        await save();
        return;
      }
      const usage = await this.work.store.usage(
        o,
        now.slice(0, 10) + "T00:00:00.000Z",
        now,
      );
      if (usage.daily >= 20 || usage.pending >= 2) {
        day.next_at = new Date(
          this.work.clock().getTime() + 60000,
        ).toISOString();
        day.error_code =
          usage.daily >= 20 ? "WORK_DAILY_QUOTA" : "PENDING_READING_WORK";
        await save();
        return;
      }
      const frozen = await new ReadingRecommendationService(this.work).freeze(
        o,
      );
      if (frozen.scope.date !== date) throw Error("READING_DAILY_DATE_EXPIRED");
      integer(day.goal - day.adopted.length, 1, 8);
      const id =
        "readwork-" +
        digest([
          o.appId,
          o.userId,
          "reading-daily",
          date,
          day.attempts + 1,
        ]).slice(0, 40);
      const row: ReadingWork = {
        ...o,
        id,
        revision: 1,
        kind: "recommend",
        status: "queued",
        input: {
          recommendation: {
            ...frozen,
            automatic: true,
            target_count: day.goal - day.adopted.length,
          },
        },
        output: null,
        adopted: {},
        attempt: 0,
        fence: null,
        lease_until: null,
        error_code: null,
        created_at: now,
        updated_at: now,
      };
      await this.work.store.save(row, 0);
      day.work_id = id;
      day.work_ids.push(id);
      day.attempts++;
      day.error_code = null;
      await save();
      return id;
    });
  }
}
