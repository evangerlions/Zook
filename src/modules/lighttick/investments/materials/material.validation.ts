import { investmentId } from "../investment.service.ts";
import {
  object,
  keys,
  integer,
  fail,
  digest,
} from "../../learning/native-learning.validation.ts";
import type { Material, MaterialSource } from "./material.types.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import type { LightTickRepository } from "../../lighttick.repository.ts";
export const materialContent = (m: Material) => ({
  title: m.title,
  content: m.content,
  locator: m.locator,
  source_url: m.source_url,
  available_at: m.available_at,
  contrary_evidence: m.contrary_evidence,
});
export const materialDigest = (m: Material) => digest(materialContent(m));
export function materialSources(v: unknown): MaterialSource[] {
  if (!Array.isArray(v) || v.length > 30)
    fail(422, "At most 30 exact material versions supported.");
  const rows = v.map((value) => {
    const s = object(value);
    keys(s, ["id", "version", "content_digest"]);
    const id = investmentId(s.id),
      version = integer(s.version, 1, 100);
    if (
      typeof s.content_digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(s.content_digest)
    )
      fail(422, "Select an exact material content digest.");
    return { id, version, content_digest: s.content_digest };
  });
  if (new Set(rows.map((s) => s.id)).size !== rows.length)
    fail(422, "Duplicate material identity.");
  return rows;
}
export async function resolveMaterials(
  repo: LightTickRepository,
  o: LightTickOwner,
  refs: MaterialSource[],
  retained: MaterialSource[] = [],
  allowArchived = false,
) {
  const result: Material[] = [];
  for (const ref of refs) {
    const current = await repo.investments.materials.get(o, ref.id),
      m = await repo.investments.materials.version(o, ref.id, ref.version);
    if (
      !current ||
      !m ||
      m.content_digest !== ref.content_digest ||
      materialDigest(m) !== ref.content_digest
    )
      fail(404, "Exact material source unavailable for this owner.");
    if (
      current.archived &&
      !allowArchived &&
      !retained.some(
        (s) =>
          s.id === ref.id &&
          s.version === ref.version &&
          s.content_digest === ref.content_digest,
      )
    )
      fail(409, "Restore archived material before making a new reference.");
    result.push(m);
  }
  return result;
}
