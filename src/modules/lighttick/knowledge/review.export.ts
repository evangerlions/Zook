import { ReadingService } from "../independent-reading/reading.service.ts";
import {exportInvestments} from "../investments/ledger.export.ts";
import {digest} from "../learning/native-learning.validation.ts";
import { createHash } from "node:crypto";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { KnowledgeService } from "./knowledge.service.ts";
import { collectReviewFacts } from "./review.facts.ts";
import { fail } from "../learning/native-learning.validation.ts";
/** Export only public product fields; never serialize jobs, operations, credentials or internal source tickets. */
export async function exportReview(
  repo: LightTickRepository,
  o: LightTickOwner,
  authorize: () => Promise<void>,
  clock = () => new Date(),
) {
  return repo.transaction(o, async () => {
    await authorize();
    const view = await collectReviewFacts(repo, o, "UTC"),
      entries = await repo.knowledge.list(o),
      service = new KnowledgeService(repo, authorize);
    const knowledge = [];
    for (const e of entries) {
      if (!(await service.allowed(o, e))) continue;
      const versions = await repo.knowledge.history(o, e.id, 2147483647, 5001);
      if (versions.length > 5000)
        fail(413, "Knowledge history exceeds export capacity.");
      const authorized = [];
      for (const v of versions)
        if (await service.allowed(o, v)) authorized.push(v);
      knowledge.push({ entry: e, versions: authorized });
    }
    const authority = await repo.getLearningAuthority(o),
      learning =
        authority?.phase === "zook" && authority.readingEnabled
          ? await repo.knowledge.learningExport(o, authority.privateEnabled)
          : null;
    const workspace = await repo.getActionWorkspace(o),
      plans = (workspace?.data.plans ?? []).map(
        ({ practice_source, ...p }) => ({
          ...p,
          ...(practice_source
            ? {
                practice_source: {
                  kind: practice_source.kind,
                  id: practice_source.id,
                  version: practice_source.version,
                },
              }
            : {}),
        }),
      );
    const investments=await exportInvestments(repo,o);
    const reading=await new ReadingService(repo,authorize,clock).export(o);
    const form_records=await repo.formRecords.get(o) ?? null;
    const learning_modules=authority?.phase==="zook"&&authority.readingEnabled?await repo.learningModules.list(o,"",1001,"all"):[];
    if(learning_modules.length>1000)fail(413,"Module export exceeds capacity; no truncated copy returned.");
    const module_history=[];
    for(const row of learning_modules){const history=await repo.learningModules.history(o,row.id,2147483648,5001);if(history.length>5000)fail(413,"Module history exceeds capacity; no truncated export.");module_history.push({id:row.id,history:history.map(({appId:_,userId:__,...v})=>v)});}
    const data = {
      format_version: 1,
      owner_id: o.userId,
      exported_at: clock().toISOString(),
      revision: digest({review:view.revision,investments,form_records,learning_modules,module_history,reading:reading.sha256}),
      form_records,
      reading,
      investments,
      metrics_version: "confirmed-facts-v2",
      facts: view.facts,
      knowledge,
      learning,
      learning_modules:learning_modules.map(({appId:_,userId:__,...row})=>row),
      learning_module_history:module_history,
      records: await Promise.all(
        (await repo.listRecords(o, { archived: "all", limit: 5001 })).map(
          async (r) => ({
            record: r.payload,
            versions: await repo.recordVersions(o, r.id),
          }),
        ),
      ),
      actions: { plans, executions: workspace?.data.records ?? [] },
      tasks: (await repo.listTasks(o)).map(({ appId, userId, ...t }) => t),
      goals: (await repo.listGoals(o)).map(({ appId, userId, ...g }) => g),
      reflections: (await repo.listReflections(o)).map(
        ({ appId, userId, ...r }) => r,
      ),
    };
    if (
      data.records.length > 5000 ||
      data.knowledge.reduce((n, k) => n + k.versions.length, 0) > 5000 ||
      Buffer.byteLength(JSON.stringify(data)) > 8 * 1024 * 1024
    )
      fail(
        413,
        "Authorized export exceeds 8 MiB/5000 rows; a chunked export is required. No truncated export is returned.",
      );
    const content = JSON.stringify(data);
    return {
      format_version: 1,
      owner_id: o.userId,
      exported_at: data.exported_at,
      revision: data.revision,
      sha256: createHash("sha256").update(content).digest("hex"),
      content_type: "application/json",
      content,
    };
  });
}
