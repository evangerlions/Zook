import {readingSourceOptions} from "./reading-source-selection.ts";
import { ReadingWorkService } from "./reading-work.service.ts";
import {
  READING_CATALOG_REVISION,
  READING_DEFAULT_SOURCES,
  READING_CLASSICS,
  READING_TOPICS,
} from "./reading-catalog.ts";
import type {
  ReadingPreferencesValue,
  ReadingPreferences,
} from "./reading-preferences.types.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import {
  object,
  keys,
  integer,
  text,
  identity,
  fail,
} from "../learning/native-learning.validation.ts";
export function defaultReadingPreferences(): ReadingPreferences {
  return {
    revision: 0,
    updated_at: null,
    value: {
      enabled: false,
      hour: 10,
      minute: 0,
      count: 3,
      mode: "mixed",
      topics: Object.keys(READING_TOPICS),
      languages: ["zh", "en"],
      query: "",
      auto_guide: false,
      source_ids: null,
    },
  };
}
export function normalizeReadingPreferences(
  raw: unknown,
): ReadingPreferencesValue {
  const b = object(raw);
  keys(b, [
    "enabled",
    "hour",
    "minute",
    "count",
    "mode",
    "topics",
    "languages",
    "query",
    "auto_guide",
    "source_ids",
  ]);
  if (
    typeof b.enabled !== "boolean" ||
    typeof b.auto_guide !== "boolean" ||
    !["recent", "classic", "mixed"].includes(String(b.mode))
  )
    fail(422, "请明确阅读采集开关、导读提示与文章类别。");
  function choices(name: string, allowed: readonly string[]) {
    const items = b[name];
    if (
      !Array.isArray(items) ||
      !items.length ||
      items.length > 1000 ||
      items.some((v) => typeof v !== "string" || !allowed.includes(v))
    )
      fail(422, "请选择有效的阅读主题与语言。");
    return [...new Set(items as string[])];
  }
  const row: ReadingPreferencesValue = {
    enabled: b.enabled as boolean,
    auto_guide: b.auto_guide as boolean,
    hour: integer(b.hour, 0, 23),
    minute: integer(b.minute, 0, 59),
    count: integer(b.count, 1, 8),
    mode: b.mode as ReadingPreferencesValue["mode"],
    topics: choices("topics", Object.keys(READING_TOPICS)),
    languages: choices("languages", ["zh", "en"]) as ("zh" | "en")[],
    query: text(b.query, 300),
  };
  if (Object.hasOwn(b, "source_ids")) {
    if (
      b.source_ids !== null &&
      (!Array.isArray(b.source_ids) || b.source_ids.length > 1000)
    )
      fail(422, "阅读源选择超过容量。");
    row.source_ids =
      b.source_ids === null
        ? null
        : [
            ...new Set(
              (b.source_ids as unknown[]).map((id) => identity(id, "source-")),
            ),
          ];
  }
  return row;
}
export class ReadingPreferencesService {
  constructor(readonly work: ReadingWorkService) {}
  get repo() {
    return this.work.repo;
  }
  async read(o: LightTickOwner) {
    return this.repo.transaction(o, async () => {
      await this.work.authorize();
      return (
        (await this.work.store.preferences.get(o)) ??
        defaultReadingPreferences()
      );
    });
  }
  async setup(o: LightTickOwner) {
    return this.repo.transaction(o,async()=>{const preferences=await this.read(o),all=await this.work.store.sources(o,"",1001,true);if(all.length>1000)fail(413,"Reading sources exceed setup capacity; no truncated selection returned");return {preferences,source_options:readingSourceOptions(all),topics:Object.keys(READING_TOPICS),default_sources:READING_DEFAULT_SOURCES,classics:READING_CLASSICS,catalog_revision:READING_CATALOG_REVISION,timezone:"Asia/Shanghai",catalogue_verification:"legacy_reference_not_live_verified"};});
  }
  async history(o: LightTickOwner, before = 2147483648) {
    integer(before, 1, 2147483648);
    return this.repo.transaction(o, async () => {
      await this.work.authorize();
      const rows = await this.work.store.preferences.history(o, before, 31);
      return {
        items: rows.slice(0, 30),
        next_cursor: rows.length > 30 ? String(rows[29].revision) : null,
      };
    });
  }
  async save(o: LightTickOwner, raw: unknown, key: string) {
    const b = structuredClone(object(raw));
    keys(b, ["base_revision", "value"]);
    const base = integer(b.base_revision, 0, 2147483646),
      value = normalizeReadingPreferences(b.value);
    return this.work.command(
      o,
      "reading-preferences",
      "preferences:save",
      b,
      key,
      async () => {
        for (const id of value.source_ids ?? []) {
          const source = await this.work.store.source(o, id);
          if (source) {
            if (source.archived || source.deleted_at)
              fail(409, "选定阅读源已变化，请保留偏好输入核对。");
            continue;
          }
          if (!READING_DEFAULT_SOURCES.some((s) => s.id === id))
            fail(409, "选定阅读源不存在或不属于本人，请保留偏好输入核对。");
        }
        const row: ReadingPreferences = {
          revision: base + 1,
          value,
          updated_at: this.work.clock().toISOString(),
        };
        await this.work.store.preferences.save(o, row, base);
        return row;
      },
    );
  }
}
