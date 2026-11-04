import type { KnowledgeSource } from "./knowledge.types.ts";
export const factKinds = [
  "record",
  "knowledge",
  "cognition",
  "lesson",
  "learning_notes",
  "lesson_completed",
  "task_completed",
  "action_completed",
  "action_execution",
  "practice_feedback",
  "reflection",
  "confirmed_insight",
] as const;
export type FactKind = (typeof factKinds)[number];
export interface ReviewFact {
  key: string;
  kind: FactKind;
  id: string;
  version: string;
  title: string;
  text: string;
  date: string | null;
  occurred_at: string | null;
  date_basis: "record_date" | "business_date" | "timestamp" | "unknown";
  sources: KnowledgeSource[];
  href: string;
  signal: string | null;
}
