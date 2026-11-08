import type { LightTickOwner } from "../lighttick.types.ts";
import type {
  NativeLesson,
  LessonPublication,
  NativePrivateState,
} from "../learning/native-learning.types.ts";
export interface KnowledgeSource {
  kind: "record" | "lesson";
  id: string;
  version: string;
}
export interface KnowledgeEntry {
  id: string;
  revision: number;
  kind: "knowledge" | "cognition";
  title: string;
  body: string;
  tags: string[];
  sources: KnowledgeSource[];
  archived: boolean;
  created_at: string;
  updated_at: string;
}
export interface KnowledgeRow extends LightTickOwner {
  entry: KnowledgeEntry;
}
export interface LearningFact {
  notesUpdatedAt?:string|null;
  lesson: NativeLesson;
  publication: LessonPublication;
  state: NativePrivateState | null;
}
export const sourceKey = (s: KnowledgeSource) =>
  JSON.stringify([s.kind, s.id, s.version]);
export interface KnowledgeRepository {
  learningExport(o:LightTickOwner,includePrivate:boolean):Promise<{publications:LessonPublication[];states:NativePrivateState[];history:import("../learning/native-learning.types.ts").LearningHistoryEntry[]}>;
  availableSources(
    o: LightTickOwner,
    sources: KnowledgeSource[],
  ): Promise<string[]>;
  get(o: LightTickOwner, id: string): Promise<KnowledgeEntry | undefined>;
  list(o: LightTickOwner): Promise<KnowledgeEntry[]>;
  history(
    o: LightTickOwner,
    id: string,
    before: number,
    limit: number,
  ): Promise<KnowledgeEntry[]>;
  save(o: LightTickOwner, e: KnowledgeEntry, base: number): Promise<void>;
  learningFacts(o: LightTickOwner): Promise<LearningFact[]>;
}
