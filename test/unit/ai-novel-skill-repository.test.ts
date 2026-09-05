import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AiNovelSkillRepository } from "../../src/modules/ai-novel/ai-novel-skill-repository.ts";

async function writeSkill(
  root: string,
  name: string,
  description: string,
  body: string,
): Promise<void> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
    "utf8",
  );
}

test("Skill repository manifest tracks additions, modifications, and deletions", async () => {
  const root = await mkdtemp(join(tmpdir(), "zook-skills-"));
  try {
    await writeSkill(root, "continuity", "Review continuity.", "Initial body.");
    const repository = new AiNovelSkillRepository(root);

    const initial = await repository.queryManifest();
    assert.deepEqual(initial.skills.map((skill) => skill.name), ["continuity"]);
    const initialPackage = await repository.fetchPackages({
      skillSetVersion: initial.skillSetVersion,
      names: ["continuity"],
    });
    assert.match(initialPackage.skills[0]?.files[0]?.content ?? "", /Initial body/);
    const initialFile = initialPackage.skills[0]?.files[0];
    assert.equal(
      initialFile?.sha256,
      createHash("sha256").update(initialFile?.content ?? "", "utf8").digest("hex"),
    );

    await writeSkill(root, "voice", "Review voice.", "Voice body.");
    const added = await repository.queryManifest();
    assert.notEqual(added.skillSetVersion, initial.skillSetVersion);
    assert.deepEqual(added.skills.map((skill) => skill.name), ["continuity", "voice"]);

    await writeSkill(root, "continuity", "Review continuity.", "Modified body.");
    const modified = await repository.queryManifest();
    const initialContinuity = initial.skills.find((skill) => skill.name === "continuity");
    const modifiedContinuity = modified.skills.find((skill) => skill.name === "continuity");
    assert.notEqual(modifiedContinuity?.version, initialContinuity?.version);

    await rm(join(root, "voice"), { recursive: true, force: true });
    const deleted = await repository.queryManifest();
    assert.deepEqual(deleted.skills.map((skill) => skill.name), ["continuity"]);
    await assert.rejects(
      repository.fetchPackages({
        skillSetVersion: modified.skillSetVersion,
        names: ["continuity"],
      }),
      (error: { code?: string }) => error.code === "AINOVEL_SKILL_SET_STALE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Skill repository never exposes non-Markdown or path-escape resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "zook-skills-"));
  try {
    await writeSkill(root, "continuity", "Review continuity.", "Body.");
    await writeFile(join(root, "continuity", "script.sh"), "echo unsafe", "utf8");
    const repository = new AiNovelSkillRepository(root);
    const manifest = await repository.queryManifest();
    const result = await repository.fetchPackages({
      skillSetVersion: manifest.skillSetVersion,
      names: ["continuity"],
    });
    assert.deepEqual(
      result.skills[0]?.files.map((file) => file.path),
      ["/skills/ainovel/continuity/SKILL.md"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
