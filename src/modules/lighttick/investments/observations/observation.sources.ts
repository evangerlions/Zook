import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import { fail, digest } from "../../learning/native-learning.validation.ts";
import type { SourceRef, PredictionFields } from "./observation.types.ts";
export async function scope(
  repo: LightTickRepository,
  o: LightTickOwner,
  instrument_id: string,
  account_id: string | null,
) {
  const instrument = await repo.investments.instrument(o, instrument_id);
  if (
    !instrument ||
    instrument.archived ||
    !["SSE", "SZSE"].includes(instrument.market) ||
    !["stock", "etf"].includes(instrument.kind)
  )
    fail(404, "Active Shanghai/Shenzhen stock/ETF required.");
  if (account_id) {
    const a = await repo.investments.account(o, account_id);
    if (!a || a.archived) fail(404, "Optional account unavailable.");
  }
  return instrument;
}
export async function resolveReferences(
  repo: LightTickRepository,
  o: LightTickOwner,
  fields: PredictionFields,
  preview = false,
) {
  const result: { ref: SourceRef; content: unknown }[] = [];
  for (const r of fields.references) {
    let content: any, current: any, expected: string;
    if (r.kind === "research") {
      current = await repo.investments.research.get(o, r.id);
      content = (
        await repo.investments.research.versions(o, r.id, r.version + 1, 1)
      )[0];
      expected = content ? digest(content) : "";
    } else if (r.kind === "material") {
      current = await repo.investments.materials.get(o, r.id);
      content = await repo.investments.materials.version(o, r.id, r.version);
      expected = content?.content_digest ?? "";
    } else if (r.kind === "screen_rule") {
      current = await repo.investments.screening.definition(o, "rules", r.id);
      content = await repo.investments.screening.definition(
        o,
        "rules",
        r.id,
        r.version,
      );
      expected = content?.definition_digest ?? "";
    } else {
      current = await repo.investments.screening.work(o, r.id);
      content = current;
      expected = content?.output?.output_digest ?? "";
      if (
        content &&
        (content.revision !== r.version ||
          content.status !== "succeeded" ||
          !content.input.sources.some(
            (s: any) => s.instrument.id === fields.instrument_id,
          ))
      )
        fail(422, "Exact successful screen result/instrument required.");
      if (
        content?.input.template.fields.account_id &&
        content.input.template.fields.account_id !== fields.account_id
      )
        fail(422, "Screen source account mismatch.");
      if (content) {
        const { appId, userId, fence, lease_until, command_keys, ...safe } =
          content;
        content = safe;
      }
    }
    if (
      !current ||
      current.archived ||
      !content ||
      content.revision !== r.version ||
      (!preview && expected !== r.digest)
    )
      fail(404, "Exact active owner source/version/digest unavailable.");
    if (
      (content.instrument_id &&
        content.instrument_id !== fields.instrument_id) ||
      (content.account_id && content.account_id !== fields.account_id)
    )
      fail(422, "Source account/instrument mismatch.");
    result.push({ ref: { ...r, digest: expected }, content });
  }
  return result;
}
export async function recheckReferences(
  repo: LightTickRepository,
  o: LightTickOwner,
  refs: SourceRef[],
) {
  for (const r of refs) {
    const current =
      r.kind === "research"
        ? await repo.investments.research.get(o, r.id)
        : r.kind === "material"
          ? await repo.investments.materials.get(o, r.id)
          : r.kind === "screen_rule"
            ? await repo.investments.screening.definition(o, "rules", r.id)
            : await repo.investments.screening.work(o, r.id);
    if (!current || ("archived" in current && current.archived))
      fail(409, "Referenced source archived or unavailable.");
  }
}
