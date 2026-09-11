import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, sep } from "node:path";

import { ApplicationError } from "../../shared/errors.ts";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VIRTUAL_ROOT = "/skills/ainovel";
const MAX_SKILL_FILE_BYTES = 128 * 1024;

export interface AiNovelSkillManifestEntry {
  name: string;
  description: string;
  location: string;
  version: string;
  sha256: string;
}

export interface AiNovelSkillManifest {
  skillSetVersion: string;
  skills: AiNovelSkillManifestEntry[];
}

export interface AiNovelSkillFile {
  path: string;
  content: string;
  sha256: string;
}

export interface AiNovelSkillPackage {
  name: string;
  version: string;
  sha256: string;
  files: AiNovelSkillFile[];
}

interface LoadedSkillPackage extends AiNovelSkillPackage {
  description: string;
  location: string;
}

/// Reads only the checked-in, text-only AINovel Skill package directory.
///
/// The client never supplies a filesystem path. It can fetch only packages and
/// virtual paths already derived from this repository-owned source tree.
export class AiNovelSkillRepository {
  constructor(
    private readonly rootDirectory = fileURLToPath(
      new URL("./resources/skills/", import.meta.url),
    ),
  ) {}

  async queryManifest(): Promise<AiNovelSkillManifest> {
    const packages = await this.loadPackages();
    return {
      skillSetVersion: fingerprint(
        packages.map((item) => ({
          name: item.name,
          version: item.version,
          sha256: item.sha256,
        })),
      ),
      skills: packages.map((item) => ({
        name: item.name,
        description: item.description,
        location: item.location,
        version: item.version,
        sha256: item.sha256,
      })),
    };
  }

  async fetchPackages(input: {
    skillSetVersion: string;
    names: string[];
  }): Promise<{ skillSetVersion: string; skills: AiNovelSkillPackage[] }> {
    const packages = await this.loadPackages();
    const skillSetVersion = fingerprint(
      packages.map((item) => ({
        name: item.name,
        version: item.version,
        sha256: item.sha256,
      })),
    );
    if (input.skillSetVersion !== skillSetVersion) {
      throw new ApplicationError(
        409,
        "AINOVEL_SKILL_SET_STALE",
        "The requested AINovel Skill set is no longer current.",
      );
    }
    const requested = new Set(input.names);
    const byName = new Map(packages.map((item) => [item.name, item]));
    const skills = [...requested].map((name) => {
      const skill = byName.get(name);
      if (!skill) {
        throw new ApplicationError(
          404,
          "AINOVEL_SKILL_NOT_FOUND",
          `AINovel Skill is not available: ${name}.`,
        );
      }
      return {
        name: skill.name,
        version: skill.version,
        sha256: skill.sha256,
        files: skill.files,
      };
    });
    return { skillSetVersion, skills };
  }

  private async loadPackages(): Promise<LoadedSkillPackage[]> {
    const root = resolve(this.rootDirectory);
    const entries = await readdir(root, { withFileTypes: true });
    const packages = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => this.loadPackage(root, entry.name)),
    );
    return packages.sort((left, right) => left.name.localeCompare(right.name));
  }

  private async loadPackage(
    root: string,
    directoryName: string,
  ): Promise<LoadedSkillPackage> {
    if (!SKILL_NAME_PATTERN.test(directoryName)) {
      throw invalidSkill(`Invalid Skill directory name: ${directoryName}.`);
    }
    const directory = resolve(root, directoryName);
    assertWithinRoot(root, directory);
    const physicalFiles = await collectMarkdownFiles(directory);
    const skillFile = physicalFiles.find((item) => item.relativePath === "SKILL.md");
    if (!skillFile) {
      throw invalidSkill(`Skill ${directoryName} must contain SKILL.md.`);
    }
    const metadata = parseMetadata(skillFile.content, directoryName);
    const files = physicalFiles.map((item) => ({
      path: `${VIRTUAL_ROOT}/${directoryName}/${item.relativePath}`,
      content: item.content,
      sha256: rawTextSha256(item.content),
    }));
    const version = fingerprint(
      files.map((item) => ({ path: item.path, sha256: item.sha256 })),
    );
    return {
      name: metadata.name,
      description: metadata.description,
      location: `${VIRTUAL_ROOT}/${directoryName}/SKILL.md`,
      version,
      sha256: fingerprint(files.map((item) => item.sha256)),
      files,
    };
  }
}

async function collectMarkdownFiles(directory: string): Promise<Array<{
  relativePath: string;
  content: string;
}>> {
  const files: Array<{ relativePath: string; content: string }> = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const child = resolve(current, entry.name);
      assertWithinRoot(directory, child);
      if (entry.isDirectory()) {
        await visit(child);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const content = await readFile(child, "utf8");
      if (Buffer.byteLength(content, "utf8") > MAX_SKILL_FILE_BYTES) {
        throw invalidSkill(`Skill file exceeds ${MAX_SKILL_FILE_BYTES} bytes: ${child}.`);
      }
      files.push({
        relativePath: relative(directory, child).split(sep).join("/"),
        content,
      });
    }
  };
  await visit(directory);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function parseMetadata(content: string, directoryName: string): {
  name: string;
  description: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw invalidSkill(`Skill ${directoryName} has invalid frontmatter.`);
  const fields = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^(name|description):\s*(.*?)\s*$/);
    if (!field) continue;
    fields.set(field[1], unquote(field[2]));
  }
  const name = fields.get("name")?.trim() ?? "";
  const description = fields.get("description")?.trim() ?? "";
  if (!SKILL_NAME_PATTERN.test(name) || name !== directoryName) {
    throw invalidSkill(`Skill name must match directory ${directoryName}.`);
  }
  if (description.isEmpty) {
    throw invalidSkill(`Skill ${directoryName} requires a description.`);
  }
  return { name, description };
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function assertWithinRoot(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== "..")) {
    return;
  }
  throw invalidSkill("Skill resource path escapes its configured root.");
}

function invalidSkill(message: string): ApplicationError {
  return new ApplicationError(500, "AINOVEL_SKILL_INVALID", message);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function rawTextSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
