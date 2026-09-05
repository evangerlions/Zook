import { ApplicationError } from "../../shared/errors.ts";
import {
  AiNovelSkillRepository,
  type AiNovelSkillManifest,
  type AiNovelSkillPackage,
} from "./ai-novel-skill-repository.ts";

/// Request validation and immutable-snapshot access for AINovel Skill updates.
export class AiNovelSkillService {
  constructor(private readonly repository: AiNovelSkillRepository) {}

  async query(): Promise<AiNovelSkillManifest> {
    return await this.repository.queryManifest();
  }

  async fetch(body: Record<string, unknown>): Promise<{
    skillSetVersion: string;
    skills: AiNovelSkillPackage[];
  }> {
    const skillSetVersion = requiredString(body.skillSetVersion, "skillSetVersion");
    const rawNames = body.names;
    if (!Array.isArray(rawNames) || rawNames.length === 0) {
      throw invalidRequest("names must be a non-empty array.");
    }
    const names = rawNames.map((value) => requiredString(value, "names[]"));
    if (new Set(names).size !== names.length) {
      throw invalidRequest("names must not contain duplicates.");
    }
    return await this.repository.fetchPackages({ skillSetVersion, names });
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidRequest(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function invalidRequest(message: string): ApplicationError {
  return new ApplicationError(400, "REQ_INVALID_BODY", message);
}
