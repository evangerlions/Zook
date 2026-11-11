import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { ReadingWork } from "./reading-work.types.ts";
import {
  object,
  keys,
  identity,
  digest,
  fail,
} from "../learning/native-learning.validation.ts";
import { readingURL } from "./reading-url.ts";
export async function candidateReadingInput(
  repo: LightTickRepository,
  o: LightTickOwner,
  raw: unknown,
  expected: { url: string; title: string },
): Promise<Partial<ReadingWork["input"]>> {
  const ref = object(raw);
  keys(ref, ["work_id", "output_digest", "candidate_id"]);
  const workId = identity(ref.work_id, "readwork-"),
    candidateId = identity(ref.candidate_id, "candidate-"),
    parent = await repo.readingWork.get(o, workId);
  if (
    !parent ||
    parent.status !== "succeeded" ||
    !parent.output ||
    digest(parent.output) !== ref.output_digest
  )
    fail(409, "候选来源结果已变化，请保留原请求并重新核对。");
  const candidate = parent.output.candidates?.find((c) => c.id === candidateId);
  if (!candidate || !candidate.content.source_url)
    fail(404, "未找到本人的指定候选条目。");
  if (
    readingURL(candidate.content.source_url) !== expected.url ||
    candidate.content.title !== expected.title
  )
    fail(409, "候选标题或链接与本次选定范围不符。");
  if (candidate.source_id) {
    const source = await repo.readingWork.source(o, candidate.source_id);
    if (
      !source ||
      source.archived ||
      source.deleted_at ||
      source.revision !== candidate.source_revision
    )
      fail(409, "候选阅读源已变化或撤回，请核对后重新采集。");
  }
  return {
    candidate_work_id: workId,
    candidate_id: candidateId,
    candidate_output_digest: ref.output_digest as string,
    source_metadata: structuredClone(candidate.content),
    ...(candidate.source_id
      ? {
          source_id: candidate.source_id,
          source_revision: candidate.source_revision!,
        }
      : {}),
  };
}
