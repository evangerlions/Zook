import { ReadingRecommendationService } from "../modules/lighttick/reading/reading-recommendation.service.ts";
import { ReadingPreferencesService } from "../modules/lighttick/reading/reading-preferences.service.ts";
import { ReadingWorkService } from "../modules/lighttick/reading/reading-work.service.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import { VocabularyService } from "../modules/lighttick/reading/vocabulary.service.ts";
import { ReadingService } from "../modules/lighttick/reading/reading.service.ts";
import {
  object,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handleReadingRequest(
  repo: LightTickRepository,
  owner: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
  work?: ReadingWorkService,
) {
  const root = "/api/v1/lighttick/reading";
  if (r.path !== root && !r.path.startsWith(root + "/")) return;
  const service = new ReadingService(repo, authorize),
    part = r.path.slice(root.length);
  if (
    [
      "/recommendation-scope",
      "/recommendations",
      "/setup",
      "/preferences",
      "/preferences/history",
    ].includes(part) ||
    part === "/sources" ||
    part.startsWith("/sources/") ||
    part === "/work" ||
    part.startsWith("/work/") ||
    part.startsWith("/work-receipts/")
  ) {
    if (!work) fail(503, "阅读采集和模型worker暂不可用，请保留输入。");
    const w = new ReadingWorkService(repo, work.queue, authorize, work.clock),
      key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
    const prefs = new ReadingPreferencesService(w),
      recommendation = new ReadingRecommendationService(w);
    if (part === "/recommendation-scope" && r.method === "GET")
      return recommendation.scope(owner);
    if (part === "/recommendations" && r.method === "POST")
      return recommendation.create(owner, r.body, key);
    if (part === "/setup" && r.method === "GET") return prefs.setup(owner);
    if (part === "/preferences" && r.method === "GET") return prefs.read(owner);
    if (part === "/preferences/history" && r.method === "GET")
      return prefs.history(
        owner,
        r.query?.cursor === undefined ? 2147483648 : Number(r.query.cursor),
      );
    if (part === "/preferences" && r.method === "PUT")
      return prefs.save(owner, r.body, key);
    if (part === "/sources" && r.method === "GET")
      return w.sources(owner, r.query?.cursor ?? "");
    if (part === "/work" && r.method === "GET")
      return w.list(owner, r.query?.cursor ?? "");
    if (part === "/work" && r.method === "POST")
      return w.create(owner, r.body, key);
    const receipt = /^\/work-receipts\/([a-zA-Z0-9_-]+)$/.exec(part);
    if (receipt && r.method === "GET")
      return repo.transaction(owner, async () => {
        await authorize();
        const row = await repo.getOperation(owner, receipt[1]);
        if (!row || row.entityType !== "reading_work")
          fail(404, "未找到本人的阅读任务原回执。");
        return {
          operation_id: row.operationId,
          entity_id: row.entityId,
          action: row.action,
          request: row.requestPayload,
          result: row.resultPayload,
        };
      });
    const source =
      /^\/sources\/(source-[a-zA-Z0-9_-]+)(?:\/(history|delete))?$/.exec(part);
    if (source) {
      if (r.method === "GET" && !source[2]) return w.source(owner, source[1]);
      if (r.method === "GET" && source[2] === "history")
        return w.sourceHistory(
          owner,
          source[1],
          r.query?.cursor === undefined ? 2147483648 : Number(r.query.cursor),
        );
      if (r.method === "PUT" && !source[2])
        return w.saveSource(owner, source[1], r.body, key);
      if (r.method === "POST" && source[2] === "delete")
        return w.deleteSource(owner, source[1], r.body, key);
    }
    const asset =
      /^\/work\/(readwork-[a-zA-Z0-9_-]+)\/assets(?:\/(readasset-[a-zA-Z0-9_-]+))?$/.exec(
        part,
      );
    if (asset && r.method === "GET")
      return asset[2]
        ? w.asset(owner, asset[1], asset[2])
        : w.assets(owner, asset[1]);
    const job = /^\/work\/(readwork-[a-zA-Z0-9_-]+)(?:\/(cancel|adopt))?$/.exec(
      part,
    );
    if (job) {
      if (r.method === "GET" && !job[2]) return w.read(owner, job[1]);
      if (r.method === "POST" && job[2] === "cancel")
        return w.cancel(owner, job[1], r.body, key);
      if (r.method === "POST" && job[2] === "adopt")
        return w.adopt(owner, job[1], r.body, key);
    }
    fail(405, "请核对阅读来源/任务的具体操作方法。");
  }
  if (r.method === "GET" && part === "/library")
    return service.list(owner, r.query);
  if (r.method === "GET" && part === "/export") return service.export(owner);
  if (part === "/vocabulary" && r.method === "GET")
    return new VocabularyService(repo, authorize).list(owner, r.query);
  const vocabulary =
    /^\/vocabulary\/(vocab-[a-zA-Z0-9_-]+)(?:\/(review|pause|archive|delete))?$/.exec(
      part,
    );
  if (vocabulary) {
    const service = new VocabularyService(repo, authorize);
    const [, id, action] = vocabulary;
    if (r.method === "GET" && !action) return service.read(owner, id);
    const key =
      r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
    if (r.method === "PUT" && !action)
      return service.write(owner, id, "add", r.body, key);
    if (r.method === "POST" && action)
      return service.write(owner, id, action, r.body, key);
    fail(405, "请核对词条操作的方法。");
  }
  const receipt = /^\/receipts\/([a-zA-Z0-9_-]+)$/.exec(part);
  if (r.method === "GET" && receipt) return service.receipt(owner, receipt[1]);
  const match =
    /^\/articles\/(article-[a-zA-Z0-9_-]+)(?:\/(history|editions|personal|position|archive|restore|draft|adopt|feedback))?$/.exec(
      part,
    );
  if (match) {
    const [, id, action] = match;
    if (r.method === "GET" && !action) return service.read(owner, id);
    if (r.method === "GET" && action === "editions")
      return service.editions(owner, id, r.query?.cursor ?? "");
    if (r.method === "GET" && action === "history")
      return service.history(
        owner,
        id,
        r.query?.cursor === undefined ? 2147483648 : Number(r.query.cursor),
      );
    const key =
      r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
    if (r.method === "PUT" && !action)
      return service.write(owner, id, "import", object(r.body), key);
    if (r.method === "POST" && action && action !== "history")
      return service.write(owner, id, action, object(r.body), key);
    fail(405, "请核对阅读操作的方法。");
  }
  fail(404, "未找到此阅读入口。");
}
