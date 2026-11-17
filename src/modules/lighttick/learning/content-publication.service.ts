import type { LightTickOwner } from "../lighttick.types.ts";
import type {
  NativeLearningRepository,
} from "./native-learning.types.ts";
import { GitHubContentService } from "./github-content.service.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { sha256 } from "../../../shared/utils.ts";

interface PublicationFile {
  before?: string;
  after: string;
  text: string;
  size: number;
}

interface PublicationRequest {
  files: Record<string, PublicationFile>;
  sql?: Array<{ query: string; params: unknown[] }>;
  binding?: Record<string, unknown>;
}

interface PublicationJournal {
  id: string;
  owner: LightTickOwner;
  moduleId?: string;
  requestHash: string;
  state: "pending" | "processing" | "done" | "failed";
  files: Record<string, PublicationFile>;
  sql?: Array<{ query: string; params: unknown[] }>;
  binding?: Record<string, unknown>;
  commitSha?: string;
  parentSha?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  finishedAt?: string;
}

interface PublicationRepository {
  getPublication(owner: LightTickOwner, id: string): Promise<PublicationJournal | undefined>;
  getPublicationByHash(owner: LightTickOwner, hash: string): Promise<PublicationJournal | undefined>;
  savePublication(journal: PublicationJournal): Promise<void>;
  updatePublicationState(id: string, state: string, updates?: Partial<PublicationJournal>): Promise<void>;
  listPendingPublications(): Promise<PublicationJournal[]>;
}

export class ContentPublicationService {
  constructor(
    private readonly repo: Pick<NativeLearningRepository, "listLearningModules">,
    private readonly pubRepo: PublicationRepository,
    private readonly applySql?: (owner: LightTickOwner, operations: NonNullable<PublicationRequest["sql"]>) => Promise<void>,
  ) {}

  private async canonical(value: unknown): Promise<string> {
    if (Array.isArray(value)) {
      return "[" + (await Promise.all(value.map((v) => this.canonical(v)))).join(",") + "]";
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b)
      );
      const parts = await Promise.all(
        entries.map(async ([k, v]) => JSON.stringify(k) + ":" + (await this.canonical(v)))
      );
      return "{" + parts.join(",") + "}";
    }
    return JSON.stringify(value);
  }

  private async computeHash(request: PublicationRequest): Promise<string> {
    const canonical = await this.canonical(request);
    return sha256(canonical);
  }

  async publish(
    owner: LightTickOwner,
    moduleId: string,
    request: PublicationRequest,
  ): Promise<{ commitSha: string; journalId: string }> {
    const requestHash = await this.computeHash(request);

    const existing = await this.pubRepo.getPublicationByHash(owner, requestHash);
    if (existing) {
      if (existing.state === "done") {
        return { commitSha: existing.commitSha!, journalId: existing.id };
      }
      if (existing.state === "pending" || existing.state === "processing") {
        throw new ApplicationError(
          409,
          "PUBLICATION_IN_PROGRESS",
          "A publication with the same content is already in progress",
        );
      }
      if (existing.state === "failed") {
        await this.pubRepo.updatePublicationState(existing.id, "pending", {
          state: "pending",
          errorCode: undefined,
          errorMessage: undefined,
          finishedAt: undefined,
        });
        return this.executePublication(existing);
      }
    }

    const journalId = `pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const journal: PublicationJournal = {
      id: journalId,
      owner,
      moduleId,
      requestHash,
      state: "pending",
      files: request.files,
      sql: request.sql,
      binding: request.binding,
      createdAt: new Date().toISOString(),
    };

    await this.pubRepo.savePublication(journal);
    return this.executePublication(journal);
  }

  private async executePublication(
    journal: PublicationJournal,
  ): Promise<{ commitSha: string; journalId: string }> {
    await this.pubRepo.updatePublicationState(journal.id, "processing");

    try {
      if (journal.sql?.length && !this.applySql) {
        throw new ApplicationError(503, "LIGHTTICK_CAPABILITY_UNAVAILABLE", "Publication SQL adapter is unavailable.");
      }
      const modules = await this.repo.listLearningModules(journal.owner);
      const module = modules.find((m) => m.id === journal.moduleId);
      if (!module || !module.sourceConfig?.github) {
        throw new ApplicationError(400, "MODULE_NOT_CONFIGURED", "Module is not configured for GitHub");
      }

      const github = module.sourceConfig.github;
      const githubService = new GitHubContentService({
        repository: github.repository,
        branch: github.branch,
        token: github.token ?? "",
        prefix: github.prefix ?? "",
      });

      const parentSha = github.lastCommitSha ?? (await githubService.getLatestCommit());
      await this.pubRepo.updatePublicationState(journal.id, "processing", {
        parentSha,
      });

      const files: Record<string, string | null> = {};
      for (const [path, file] of Object.entries(journal.files)) {
        files[path] = file.text;
      }

      const commit = await githubService.publish(
        files,
        `Publish content update\n\nModule: ${journal.moduleId}\nJournal: ${journal.id}`,
        parentSha,
      );

      if (journal.sql && journal.sql.length > 0) {
        await this.applySql!(journal.owner, journal.sql);
      }

      await this.pubRepo.updatePublicationState(journal.id, "done", {
        commitSha: commit.sha,
        finishedAt: new Date().toISOString(),
      });

      return { commitSha: commit.sha, journalId: journal.id };
    } catch (error) {
      const errorCode = error instanceof ApplicationError ? error.code : "PUBLICATION_FAILED";
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.pubRepo.updatePublicationState(journal.id, "failed", {
        errorCode,
        errorMessage,
        finishedAt: new Date().toISOString(),
      });

      throw error;
    }
  }

  async recover(): Promise<number> {
    const pending = await this.pubRepo.listPendingPublications();
    let recovered = 0;

    for (const journal of pending) {
      try {
        if (journal.state === "pending") {
          await this.executePublication(journal);
          recovered++;
        } else if (journal.state === "processing") {
          if (journal.parentSha && !journal.commitSha) {
            await this.pubRepo.updatePublicationState(journal.id, "pending");
            await this.executePublication(journal);
            recovered++;
          } else {
            await this.pubRepo.updatePublicationState(journal.id, "failed", {
              errorCode: "RECOVERY_TIMEOUT",
              errorMessage: "Publication was interrupted and cannot be recovered",
              finishedAt: new Date().toISOString(),
            });
          }
        }
      } catch (error) {
        console.error(`Failed to recover publication ${journal.id}:`, error);
      }
    }

    return recovered;
  }

  async getPublicationStatus(owner: LightTickOwner, id: string): Promise<PublicationJournal | undefined> {
    return this.pubRepo.getPublication(owner, id);
  }

  async listPublications(
    owner: LightTickOwner,
    moduleId?: string,
  ): Promise<PublicationJournal[]> {
    const all = await this.pubRepo.listPendingPublications();
    return all.filter((j) => j.owner.userId === owner.userId && (!moduleId || j.moduleId === moduleId));
  }
}
