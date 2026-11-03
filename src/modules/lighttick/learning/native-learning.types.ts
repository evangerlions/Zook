import type {
  LightTickOperationRow,
  LightTickOwner,
} from "../lighttick.types.ts";
export type LearningAuthorityPhase =
  | "legacy"
  | "frozen"
  | "imported"
  | "verified"
  | "zook";
export interface LearningAuthority extends LightTickOwner {
  module: "learning";
  readingEnabled: boolean;
  privateEnabled: boolean;
  phase: LearningAuthorityPhase;
  epoch: number;
  revision: number;
  manifestHash: string | null;
  sourceBinding: string | null;
  updatedAt: string;
}
export interface LearningCollection extends LightTickOwner {
  id: string;
  title: string;
  revision: number;
  archived: boolean;
  updatedAt: string;
}
export interface NativeLesson extends LightTickOwner {
  id: string;
  collectionId: string;
  number: number;
  title: string;
  revision: number;
  publishedVersion: string | null;
  sourceCompleted?: boolean;
  archived: boolean;
  updatedAt: string;
}
export interface LessonPublication extends LightTickOwner {
  lessonId: string;
  contentVersion: string;
  content: string;
  references: string;
  sourceUrl: string;
  createdAt: string;
}
export interface LearningAnswer {
  id: string;
  prompt: string;
  answer: string;
}
export interface NativePrivateState extends LightTickOwner {
  lessonId: string;
  contentVersion: string;
  revision: number;
  draftVersion?: string;
  notesRevision: number;
  positionRevision: number;
  completionRevision: number;
  notes: string;
  answers: LearningAnswer[];
  position: number;
  completed: boolean;
  completedAt: string | null;
  updatedAt: string;
}
export interface LearningHistoryEntry extends LightTickOwner {
  id: string;
  lessonId: string;
  contentVersion: string;
  component: "initial" | "notes" | "position" | "completion" | "import";
  revision: number;
  state: NativePrivateState;
  createdAt: string;
}
export interface NativeLearningRepository {
  getNativeLearningCounts(
    owner: LightTickOwner,
  ): Promise<Record<string, number>>;
  clearNativeLearningStaging(owner: LightTickOwner): Promise<void>;
  listLearningReceipts(
    owner: LightTickOwner,
    lessonId: string,
  ): Promise<LightTickOperationRow[]>;
  getLearningAuthority(
    owner: LightTickOwner,
  ): Promise<LearningAuthority | undefined>;
  saveLearningAuthority(
    row: LearningAuthority,
    expectedRevision: number,
  ): Promise<void>;
  listLearningCollections(
    owner: LightTickOwner,
    after: string,
    limit: number,
  ): Promise<LearningCollection[]>;
  getLearningCollection(
    owner: LightTickOwner,
    id: string,
  ): Promise<LearningCollection | undefined>;
  saveLearningCollection(
    row: LearningCollection,
    expectedRevision: number,
  ): Promise<void>;
  listNativeLessons(
    owner: LightTickOwner,
    after: string,
    limit: number,
    collectionId?: string,
  ): Promise<NativeLesson[]>;
  getNativeLesson(
    owner: LightTickOwner,
    id: string,
  ): Promise<NativeLesson | undefined>;
  saveNativeLesson(row: NativeLesson, expectedRevision: number): Promise<void>;
  getLessonPublication(
    owner: LightTickOwner,
    lessonId: string,
    version: string,
  ): Promise<LessonPublication | undefined>;
  insertLessonPublication(row: LessonPublication): Promise<void>;
  getNativePrivateState(
    owner: LightTickOwner,
    lessonId: string,
    version: string,
  ): Promise<NativePrivateState | undefined>;
  saveNativePrivateState(
    row: NativePrivateState,
    expectedRevision: number,
  ): Promise<void>;
  appendLearningHistory(row: LearningHistoryEntry): Promise<void>;
  listLearningHistory(
    owner: LightTickOwner,
    lessonId: string,
    version: string,
    before: string,
    limit: number,
  ): Promise<LearningHistoryEntry[]>;
}
