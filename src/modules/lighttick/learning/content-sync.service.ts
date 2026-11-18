import type { LightTickOwner } from "../lighttick.types.ts";
import type {
  NativeLearningRepository,
  LearningModule,
  NativeLesson,
  LearningCollection,
  SourceConfig,
} from "./native-learning.types.ts";
import { GitHubContentService } from "./github-content.service.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { sha256 } from "../../../shared/utils.ts";

interface SyncOptions {
  moduleId: string;
  force?: boolean;
}

interface SyncResult {
  moduleId: string;
  commit_sha: string;
  added: number;
  updated: number;
  deleted: number;
  synced_at: string;
  status: "success" | "error" | "skipped";
  error?: string;
}

interface ContentParser {
  parseMarkdown(content: string): {
    title: string;
    description: string;
    questions: Array<{ id: string; prompt: string }>;
    references: string;
  };
}

class DefaultContentParser implements ContentParser {
  parseMarkdown(content: string) {
    const lines = content.split("\n");
    let title = "";
    let description = "";
    const questions: Array<{ id: string; prompt: string }> = [];
    const references: string[] = [];

    let inFrontmatter = false;
    let frontmatterDone = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (i === 0 && line.trim() === "---") {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter && line.trim() === "---") {
        inFrontmatter = false;
        frontmatterDone = true;
        continue;
      }
      if (inFrontmatter) continue;

      if (!title && line.startsWith("# ")) {
        title = line.slice(2).trim();
      } else if (!description && line.trim() && !line.startsWith("#")) {
        description = line.trim().slice(0, 200);
      } else if (line.match(/^##\s+(问题|思考|Questions?)/i)) {
        for (let j = i + 1; j < lines.length; j++) {
          const qLine = lines[j];
          if (qLine.startsWith("## ")) break;
          const match = qLine.match(/^\d+\.\s+(.+)/);
          if (match) {
            questions.push({
              id: `q-${questions.length + 1}`,
              prompt: match[1].trim(),
            });
          }
        }
      } else if (line.match(/^##\s+(参考|References?)/i)) {
        for (let j = i + 1; j < lines.length; j++) {
          const rLine = lines[j];
          if (rLine.startsWith("## ")) break;
          if (rLine.trim()) references.push(rLine.trim());
        }
      }
    }

    return {
      title: title || "Untitled",
      description: description || "",
      questions,
      references: references.join("\n"),
    };
  }
}

export class LearningContentSyncService {
  private readonly parser: ContentParser;

  constructor(
    private readonly repo: NativeLearningRepository,
    parser?: ContentParser,
  ) {
    this.parser = parser ?? new DefaultContentParser();
  }

  async syncModule(
    owner: LightTickOwner,
    module: LearningModule,
    options: SyncOptions,
  ): Promise<SyncResult> {
    const result: SyncResult = {
      moduleId: module.id,
      commit_sha: "",
      added: 0,
      updated: 0,
      deleted: 0,
      synced_at: new Date().toISOString(),
      status: "success",
    };

    try {
      if (!module.sourceConfig?.github) {
        result.status = "skipped";
        result.error = "No GitHub configuration";
        return result;
      }

      const github = module.sourceConfig.github;
      const githubService = new GitHubContentService({
        repository: github.repository,
        branch: github.branch,
        token: github.token ?? "",
        prefix: github.prefix ?? "",
      });

      const currentCommit = await githubService.getLatestCommit();
      if (!options.force && module.lastSyncedAt && github.lastCommitSha === currentCommit) {
        result.commit_sha = currentCommit;
        result.status = "skipped";
        return result;
      }

      const remoteFiles = await githubService.listFiles();
      const remotePaths = new Set(remoteFiles.map((f) => f.path));

      const collections = await this.repo.listLearningCollections(owner, "", 1000);
      const moduleCollections = collections.filter((c) => c.moduleId === module.id);

      const lessons = await this.repo.listNativeLessons(owner, "", 10000);
      const moduleLessons = lessons.filter((l) => l.moduleId === module.id);
      const localPaths = new Set(moduleLessons.map((l) => `${l.id}.md`));

      for (const file of remoteFiles) {
        if (!file.path.endsWith(".md")) continue;
        const content = await githubService.readText(file.path);
        const parsed = this.parser.parseMarkdown(content);

        const lessonId = file.path.replace(/\.md$/, "");
        const existing = moduleLessons.find((l) => l.id === lessonId);

        const contentHash = sha256(content);

        if (existing) {
          if (existing.publishedVersion !== contentHash || options.force) {
            const publication = await this.repo.getLessonPublication(owner, lessonId, existing.publishedVersion ?? "");
            if (!publication || publication.contentVersion !== contentHash) {
              await this.repo.insertLessonPublication({
                ...owner,
                lessonId,
                contentVersion: contentHash,
                content: JSON.stringify(parsed),
                references: parsed.references,
                sourceUrl: `github://${github.repository}/${file.path}`,
                createdAt: new Date().toISOString(),
              });
            }

            await this.repo.saveNativeLesson(
              {
                ...existing,
                revision: existing.revision + 1,
                title: parsed.title,
                publishedVersion: contentHash,
                updatedAt: new Date().toISOString(),
              },
              existing.revision,
            );
            result.updated++;
          }
        } else {
          const collectionId = moduleCollections[0]?.id ?? `collection-${module.id}`;
          if (!moduleCollections[0]) {
            await this.repo.saveLearningCollection(
              {
                ...owner,
                id: collectionId,
                moduleId: module.id,
                title: module.title,
                description: module.description,
                revision: 1,
                archived: false,
                updatedAt: new Date().toISOString(),
              },
              0,
            );
            moduleCollections.push((await this.repo.getLearningCollection(owner, collectionId))!);
          }


          const lessonNumber = Math.max(0, ...moduleLessons.map(l => l.number)) + result.added + 1;
          await this.repo.saveNativeLesson(
            {
              ...owner,
              id: lessonId,
              moduleId: module.id,
              collectionId,
              number: lessonNumber,
              title: parsed.title,
              revision: 1,
              publishedVersion: contentHash,
              archived: false,
              updatedAt: new Date().toISOString(),
            },
            0,
          );
          await this.repo.insertLessonPublication({
            ...owner,
            lessonId,
            contentVersion: contentHash,
            content: JSON.stringify(parsed),
            references: parsed.references,
            sourceUrl: `github://${github.repository}/${file.path}`,
            createdAt: new Date().toISOString(),
          });
          result.added++;
        }
      }

      for (const localPath of localPaths) {
        if (!remotePaths.has(localPath)) {
          const lessonId = localPath.replace(/\.md$/, "");
          const existing = moduleLessons.find((l) => l.id === lessonId);
          if (existing) {
            await this.repo.saveNativeLesson(
              {
                ...existing,
                revision: existing.revision + 1,
                archived: true,
                updatedAt: new Date().toISOString(),
              },
              existing.revision,
            );
            result.deleted++;
          }
        }
      }

      const updatedConfig: SourceConfig = {
        ...module.sourceConfig,
        github: {
          ...github,
          lastCommitSha: currentCommit,
        },
      };

      await this.repo.saveLearningModule(
        {
          ...module,
          revision: module.revision + 1,
          sourceConfig: updatedConfig,
          lastSyncedAt: result.synced_at,
          syncStatus: "idle",
          updatedAt: result.synced_at,
        },
        module.revision,
      );

      result.commit_sha = currentCommit;
      return result;
    } catch (error) {
      result.status = "error";
      result.error = error instanceof Error ? error.message : String(error);

      await this.repo.saveLearningModule(
        {
          ...module,
          revision: module.revision + 1,
          syncStatus: "error",
          updatedAt: result.synced_at,
        },
        module.revision,
      );

      return result;
    }
  }

  async syncAllModules(
    owner: LightTickOwner,
    options?: { force?: boolean },
  ): Promise<SyncResult[]> {
    const modules = await this.repo.listLearningModules(owner);
    const githubModules = modules.filter(
      (m) => m.sourceType === "github" && m.sourceConfig?.github,
    );

    const results: SyncResult[] = [];
    for (const module of githubModules) {
      const syncing = {...module,revision: module.revision + 1,syncStatus: 'syncing' as const,updatedAt: new Date().toISOString()};
      await this.repo.saveLearningModule(syncing,module.revision);

      const result = await this.syncModule(owner, syncing, {
        moduleId: module.id,
        force: options?.force,
      });
      results.push(result);
    }

    return results;
  }
}
