import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { ReviewFact } from "./review.types.ts";
import { sourceKey } from "./knowledge.types.ts";
import { digest, fail } from "../learning/native-learning.validation.ts";
export async function collectReviewFacts(
  repo: LightTickRepository,
  o: LightTickOwner,
  timezone: string,
) {
  const day = (time: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(time));
  const records = await repo.listRecords(o, { archived: "false", limit: 5001 }),
    entries = await repo.knowledge.list(o),
    workspace = await repo.getActionWorkspace(o),
    authority = await repo.getLearningAuthority(o);
  const learning =
    authority?.phase === "zook" && authority.readingEnabled
      ? await repo.knowledge.learningFacts(o)
      : [];
  const tasks = await repo.listTasks(o),
    reflections = await repo.listReflections(o),
    insights = (await repo.listDnaInsights(o)).filter(
      (i) => i.status === "confirmed",
    );
  for (const rows of [
    records,
    entries,
    learning,
    tasks,
    reflections,
    insights,
    workspace?.data.plans ?? [],
    workspace?.data.records ?? [],
  ])
    if (rows.length > 5000)
      fail(
        413,
        "Review snapshot exceeds 5000 rows per domain; a larger indexed projection is required.",
      );
  const selected = entries.filter((e) => !e.archived),
    available = new Set(
      await repo.knowledge.availableSources(
        o,
        selected.flatMap((e) => e.sources),
      ),
    );
  const facts: ReviewFact[] = [];
  const add = (
    v: Omit<ReviewFact, "key" | "date_basis" | "date" | "signal" | "sources"> &
      Partial<Pick<ReviewFact, "date_basis" | "date" | "signal" | "sources">>,
  ) =>
    facts.push({
      key: digest([v.kind, v.id, v.version]),
      date: v.occurred_at ? day(v.occurred_at) : null,
      date_basis: v.occurred_at ? "timestamp" : "unknown",
      signal: null,
      sources: [],
      ...v,
    });
  for (const { payload: r } of records)
    add({
      kind: "record",
      id: r.id,
      version: String(r.version),
      title: r.raw_text.slice(0, 80),
      text: [
        r.raw_text,
        ...Object.values(r.guided_answers),
        r.adopted_summary ?? "",
        ...r.tags,
      ].join("\n"),
      sources: [{ kind: "record", id: r.id, version: String(r.version) }],
      date: r.record_date,
      date_basis: "record_date",
      occurred_at: r.updated_at,
      href: "/grow/records?record_id=" + encodeURIComponent(r.id),
    });
  for (const e of selected)
    if (e.sources.every((s) => available.has(sourceKey(s))))
      add({
        kind: e.kind,
        id: e.id,
        version: String(e.revision),
        title: e.title,
        text: [e.body, ...e.tags].join("\n"),
        occurred_at: e.updated_at,
        sources: e.sources,
        href: "/grow/review?entry_id=" + e.id,
        signal: e.kind === "cognition" ? "owner_interpretation" : "owner_saved",
      });
  for (const { lesson: l, publication: p, state: s, notesUpdatedAt } of learning) {
    const source = {
        kind: "lesson" as const,
        id: l.id,
        version: p.contentVersion,
      },
      href = "/grow/learning?lesson_id=" + l.id;
    add({
      kind: "lesson",
      id: l.id,
      version: p.contentVersion,
      title: l.title,
      text: p.content + "\n" + p.references,
      occurred_at: p.createdAt,
      href,
      sources: [source],
    });
    if (authority?.privateEnabled && s && (s.notes || s.answers.length))
      add({
        kind: "learning_notes",
        id: l.id,
        version: p.contentVersion + ":" + s.notesRevision,
        title: l.title + " · 私人笔记/作答",
        text:
          s.notes +
          "\n" +
          s.answers.map((a) => a.prompt + "\n" + a.answer).join("\n"),
        occurred_at: notesUpdatedAt??null,
        href,
        sources: [source],
      });
    if (
      (authority?.privateEnabled && s?.completed) ||
      (l.sourceCompleted && l.sourceCompletedVersion === p.contentVersion)
    )
      add({
        kind: "lesson_completed",
        id: l.id,
        version: p.contentVersion,
        title: l.title + " · 明确学完",
        text: "本正文版本明确完成，不代表实践成功或能力掌握。",
        occurred_at:
          authority?.privateEnabled && s?.completed ? s.completedAt : null,
        href,
        sources: [source],
        signal: "explicit_learning_completion",
      });
  }
  for (const t of tasks)
    if (t.status === "completed")
      add({
        kind: "task_completed",
        id: t.id,
        version: String(t.version),
        title: t.title,
        text: t.notes ?? "",
        occurred_at: t.completedAt ?? null,
        href: "/grow/plans?task_id=" + encodeURIComponent(t.id),
        signal: "task_completion",
      });
  for (const p of workspace?.data.plans ?? []) {
    if (p.status === "completed")
      add({
        kind: "action_completed",
        id: p.id,
        version: String(p.revision),
        title: p.title,
        text: p.reason,
        occurred_at: p.completed_at,
        href: "/grow/actions?plan_id=" + p.id,
        signal: "action_completion",
      });
    for (const f of p.practice_feedback ?? [])
      add({
        kind: "practice_feedback",
        id: f.id,
        version: String(p.revision),
        title: p.title + " · 实践反馈",
        text: [f.result, f.evidence, f.next_step].join("\n"),
        occurred_at: f.created_at,
        href: "/grow/practice?plan_id=" + p.id,
        signal: f.outcome,
      });
  }
  for (const e of workspace?.data.records ?? [])
    if (e.record_kind === "session" && e.outcome !== "running")
      add({
        kind: "action_execution",
        id: e.id,
        version: digest(e),
        title: e.title,
        text: e.note,
        occurred_at: e.ended_at,
        date: e.business_date,
        date_basis: "business_date",
        href: "/grow/actions?plan_id=" + e.plan_id,
        signal: e.outcome,
      });
  for (const r of reflections)
    add({
      kind: "reflection",
      id: r.id,
      version: String(r.version),
      title: "复盘 " + r.periodStart + "—" + r.periodEnd,
      text: r.content + "\n" + r.nextAction,
      occurred_at: r.updatedAt,
      href: "/grow/goals?goal_id=" + encodeURIComponent(r.goalId),
      signal: "owner_saved",
    });
  for (const i of insights)
    add({
      kind: "confirmed_insight",
      id: i.id,
      version: String(i.version),
      title: "已确认的观察",
      text: i.statement,
      occurred_at: i.updatedAt,
      href: "/grow/review",
      signal: "owner_confirmed_not_objective_proof",
    });
  if (Buffer.byteLength(JSON.stringify(facts)) > 8 * 1024 * 1024)
    fail(
      413,
      "Review snapshot exceeds 8 MiB; a larger indexed projection is required.",
    );
  facts.sort(
    (a, b) =>
      (b.date ?? "").localeCompare(a.date ?? "") ||
      (b.occurred_at ?? "").localeCompare(a.occurred_at ?? "") ||
      (a.key < b.key ? -1 : 1),
  );
  return {
    facts,
    revision: digest({
      owner: o,
      timezone,
      authority: authority
        ? { epoch: authority.epoch, revision: authority.revision }
        : null,
      facts,
    }),
  };
}
