export const experienceTextOrder = (a: string, b: string) =>
  Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
import type {
  ExperienceObject,
  ExperienceQuery,
  ExperienceSummary,
  ApplicationData,
  ErrorData,
  ErrorTypeData,
} from "./experience.types.ts";
export function experienceSummary(r: ExperienceObject): ExperienceSummary {
  const d = r.data as ApplicationData & ErrorData & ErrorTypeData;
  return {
    id: r.id,
    kind: r.kind,
    revision: r.revision,
    archived: r.archived,
    date: d.date ?? null,
    classification: r.classification,
    title:
      r.kind === "application"
        ? d.concept
        : r.kind === "error"
          ? d.error_type
          : d.name,
    preview: Array.from(
      r.kind === "application" ? (d.scenario ?? "") : d.description,
    )
      .slice(0, 160)
      .join(""),
    grade:
      r.kind === "application"
        ? d.effectiveness
        : r.kind === "error"
          ? d.severity
          : null,
    is_repeat: d.is_repeat ?? null,
    related_error_id: d.related_error_id ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
export function matchesExperience(
  r: ExperienceObject,
  q: ExperienceQuery,
  dates = true,
) {
  const d = r.data as ApplicationData & ErrorData & ErrorTypeData;
  return (
    r.kind === q.kind &&
    (q.archived === "all" || r.archived === (q.archived === "archived")) &&
    (!q.module_id || d.module_id === q.module_id) &&
    (!q.error_type || d.error_type === q.error_type) &&
    (q.is_repeat === null || d.is_repeat === q.is_repeat) &&
    (!dates ||
      ((!q.date_from || (!!d.date && d.date >= q.date_from)) &&
        (!q.date_to || (!!d.date && d.date <= q.date_to)))) &&
    (!q.search ||
      [
        d.concept,
        d.scenario,
        d.error_type,
        d.description,
        d.context,
        d.improvement_action,
        d.name,
      ]
        .join("\n")
        .toLowerCase()
        .includes(q.search.toLowerCase()))
  );
}
