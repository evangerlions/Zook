import type { LightTickOwner } from "../lighttick.types.ts";
export interface Invitation {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  usedAt: string | null;
  tokenHash: string;
}
export interface Survey {
  clarity_score: number;
  progress_score: number;
  saved_at: string;
}
export interface Trial {
  id: string;
  version: number;
  enrolled_at: string;
  timezone: string;
  surveys: Record<string, Survey[]>;
}
export interface ParticipationStore {
  activeCount(o: LightTickOwner, now: string): Promise<number>;
  list(o: LightTickOwner): Promise<Invitation[]>;
  get(id: string, lock?: boolean): Promise<Invitation | undefined>;
  save(o: LightTickOwner, i: Invitation): Promise<void>;
  claim(o: LightTickOwner, id: string): Promise<void>;
  claimed(o: LightTickOwner): Promise<string | undefined>;
  trial(o: LightTickOwner): Promise<Trial | undefined>;
  saveTrial(o: LightTickOwner, t: Trial): Promise<void>;
}
