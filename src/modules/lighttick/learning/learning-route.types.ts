import type { LightTickOwner } from "../lighttick.types.ts";
import type { LearningWorkRepository } from "./learning-work.types.ts";
export interface CourseBrief {
  title: string; goal: string; level: string; minutes: number;
  pacing: "weekly" | "self_paced"; weeks?: number; sessions?: number; lesson_count?: number;
}
export interface CourseLessonSpec {
  number: number; topic: string; goal: string; exercise: string; assessment: string;
  minutes: number; stage: number; kind: "lesson" | "review"; requires: number[];
}
export interface CourseDocument {
  prerequisites: string; stages: { title: string; goal: string }[]; lessons: CourseLessonSpec[];
}
export interface LearningRoute extends LightTickOwner {
  id: string; revision: number; publishedVersion: number; status: "draft" | "active" | "paused" | "archived";
  brief: CourseBrief; document: CourseDocument; updatedAt: string;
}
export interface LearningRouteVersion extends LightTickOwner {
  routeId: string; version: number; brief: CourseBrief; document: CourseDocument; digest: string; createdAt: string|null;
}
export interface RouteLessonLink extends LightTickOwner {
  routeId: string; number: number; lessonId: string; routeVersion: number; firstContentVersion: string;
}
export interface LearningRouteRepository {
  counts(owner: LightTickOwner): Promise<Record<string,number>>;
  clearStaging(owner: LightTickOwner): Promise<void>;
  readonly work: LearningWorkRepository;
  readRouteProgressFacts(owner: LightTickOwner, id: string): Promise<{ number: number; lessonId: string; contentVersion: string; completed: boolean; sourceCompleted: boolean }[]>;
  getLearningRoute(owner: LightTickOwner, id: string): Promise<LearningRoute | undefined>;
  listLearningRoutes(owner: LightTickOwner, after: string, limit: number, publishedOnly?: boolean): Promise<LearningRoute[]>;
  saveLearningRoute(row: LearningRoute, expectedRevision: number): Promise<void>;
  getLearningRouteVersion(owner: LightTickOwner, id: string, version: number): Promise<LearningRouteVersion | undefined>;
  insertLearningRouteVersion(row: LearningRouteVersion): Promise<void>;
  listRouteLessonLinks(owner: LightTickOwner, id: string): Promise<RouteLessonLink[]>;
  insertRouteLessonLink(row: RouteLessonLink): Promise<void>;
}
