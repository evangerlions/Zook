export interface KickoffMeta {
  titleCandidate: string;
  readiness: number;
  storyPromise: string;
  storyAnchors: StoryAnchor[];
  focalization: string;
  startState: string;
  trigger: string;
  drive: KickoffDrive;
  pressureSources: string[];
  stakes: KickoffStakes;
  worldConstraints: string[];
  changeHorizon: string;
  premiseScale: KickoffScale;
  language: string;
  toneRegister: string;
  extras: Record<string, unknown>;
}

export interface StoryAnchor {
  label: string;
  name?: string;
  role: string;
  rules: string[];
}

export interface KickoffDrive {
  mode: string;
  object: string;
}

export interface KickoffStakes {
  external: string;
  relational: string;
  internal: string;
}

export interface KickoffScale {
  length: KickoffScaleChoice;
  chapterLength: KickoffChapterLength;
  pov: KickoffScaleChoice;
  threadDensity: KickoffScaleChoice;
  pace: KickoffScaleChoice;
}

export interface KickoffScaleChoice {
  preset: string;
  note: string;
}

export interface KickoffChapterLength {
  preset: string;
  minChars?: number;
  maxChars?: number;
  note: string;
}
